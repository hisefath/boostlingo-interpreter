// Cascade playback (lld §5): plays turns in seq order, never waits on failed/empty turns, barge-in cuts,
// and reports `playing` so the transport can mute mic frames while our own audio plays (echo guard, FR-020).
import type { TurnState } from "../shared/contracts.ts";
import { pcm16ToFloat } from "./lib.ts";

const RATE = 24000;
/** a turn with no live audio, no new chunk for this long, and later audio waiting, is treated as finished */
const STALL_MS = 1500;

interface Q {
  pending: Int16Array[];
  final: boolean;
  started: boolean;
  live: Set<AudioBufferSourceNode>;
  lastChunkAt: number;
}

export interface PlayerEvents {
  firstAudio(seq: number, t: number): void;
  audioEnd(seq: number, t: number): void;
  cut(seq: number): void;
}

export class Player {
  readonly ctx = new AudioContext();
  private out = this.ctx.createMediaStreamDestination();
  private gain = this.ctx.createGain();
  private queues = new Map<number, Q>();
  private nextTime = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private ev: PlayerEvents) {
    this.gain.connect(this.ctx.destination);
    this.gain.connect(this.out);
  }

  get stream(): MediaStream {
    return this.out.stream;
  }

  get playing(): boolean {
    for (const q of this.queues.values()) if (q.live.size) return true;
    return false;
  }

  push(seq: number, pcm: Int16Array): void {
    const q = this.q(seq);
    if (!q) return;
    q.pending.push(pcm);
    q.lastChunkAt = performance.now();
    this.pump();
  }

  setState(seq: number, state: TurnState): void {
    if (state === "done" || state === "failed" || state === "empty" || state === "cut") {
      const q = this.q(seq);
      if (q) q.final = true;
      if (state !== "done" && q) q.pending = []; // never play a failed/cut turn's leftovers late (INV-3)
      this.pump();
    } else this.q(seq);
  }

  /** a new turn's speech ended: cut everything older that is still queued or playing (D19) */
  bargeIn(seq: number): void {
    for (const [s, q] of this.queues) {
      if (s >= seq || (!q.live.size && !q.pending.length)) continue;
      q.live.forEach((src) => {
        src.onended = null;
        src.stop();
      });
      this.queues.delete(s);
      this.done.add(s);
      this.ev.cut(s);
    }
    this.nextTime = 0;
    this.pump();
  }

  close(): void {
    clearTimeout(this.timer);
    void this.ctx.close();
  }

  private done = new Set<number>();

  private q(seq: number): Q | undefined {
    if (this.done.has(seq)) return undefined;
    let q = this.queues.get(seq);
    if (!q) {
      q = { pending: [], final: false, started: false, live: new Set(), lastChunkAt: 0 };
      this.queues.set(seq, q);
    }
    return q;
  }

  private finish(seq: number, q: Q): void {
    this.queues.delete(seq);
    this.done.add(seq);
    if (q.started) this.ev.audioEnd(seq, performance.now());
  }

  private pump(): void {
    clearTimeout(this.timer);
    for (;;) {
      if (!this.queues.size) return;
      const seq = Math.min(...this.queues.keys());
      const q = this.queues.get(seq)!;
      for (const pcm of q.pending) this.schedule(seq, q, pcm);
      q.pending = [];
      if (q.live.size) return;
      const laterWaiting = [...this.queues].some(([s, o]) => s > seq && o.pending.length);
      const stalled = laterWaiting && performance.now() - q.lastChunkAt > STALL_MS;
      if (q.final || stalled) {
        this.finish(seq, q);
        continue;
      }
      if (laterWaiting) this.timer = setTimeout(() => this.pump(), STALL_MS);
      return;
    }
  }

  private schedule(seq: number, q: Q, pcm: Int16Array): void {
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, RATE);
    buf.copyToChannel(pcm16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    src.start(at);
    this.nextTime = at + buf.duration;
    q.live.add(src);
    if (!q.started) {
      q.started = true;
      this.ev.firstAudio(seq, performance.now() + (at - this.ctx.currentTime) * 1000);
    }
    src.onended = () => {
      q.live.delete(src);
      this.pump();
    };
  }
}
