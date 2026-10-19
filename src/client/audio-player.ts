// Cascade playback (lld §5): plays turns in seq order, never waits on failed/empty turns, barge-in cuts,
// and reports `playing` so the transport can mute mic frames while our own audio plays (echo guard, FR-020).
import type { TurnState } from "../shared/contracts.ts";
import { pcm16ToFloat } from "./timing-and-audio-helpers.ts";

const PLAYBACK_SAMPLE_RATE = 24000;
/** a turn with no live audio, no new chunk for this long, and later audio waiting, is treated as finished */
const STALL_MS = 1500;

interface TurnAudioQueue {
  pending: Int16Array[];
  final: boolean;
  started: boolean;
  playingSources: Set<AudioBufferSourceNode>;
  lastChunkAt: number;
}

export interface AudioPlayerEvents {
  firstAudio(seq: number, atMs: number): void;
  audioEnd(seq: number, atMs: number): void;
  cut(seq: number): void;
}

export class AudioPlayer {
  readonly audioContext = new AudioContext();
  private outputDestination = this.audioContext.createMediaStreamDestination();
  private gain = this.audioContext.createGain();
  private queues = new Map<number, TurnAudioQueue>();
  private nextTime = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private events: AudioPlayerEvents) {
    this.gain.connect(this.audioContext.destination);
    this.gain.connect(this.outputDestination);
  }

  get stream(): MediaStream {
    return this.outputDestination.stream;
  }

  get playing(): boolean {
    for (const queue of this.queues.values()) if (queue.playingSources.size) return true;
    return false;
  }

  push(seq: number, pcm: Int16Array): void {
    const queue = this.queueFor(seq);
    if (!queue) return;
    queue.pending.push(pcm);
    queue.lastChunkAt = performance.now();
    this.playQueuedAudio();
  }

  setState(seq: number, state: TurnState): void {
    if (state === "done" || state === "failed" || state === "empty" || state === "cut") {
      const queue = this.queueFor(seq);
      if (queue) queue.final = true;
      if (state !== "done" && queue) queue.pending = []; // never play a failed/cut turn's leftovers late (INV-3)
      this.playQueuedAudio();
    } else this.queueFor(seq);
  }

  /** a new turn's speech ended: cut everything older that is still queued or playing (D19) */
  bargeIn(seq: number): void {
    for (const [queuedSeq, queue] of this.queues) {
      if (queuedSeq >= seq || (!queue.playingSources.size && !queue.pending.length)) continue;
      queue.playingSources.forEach((sourceNode) => {
        sourceNode.onended = null;
        sourceNode.stop();
      });
      this.queues.delete(queuedSeq);
      this.finishedTurns.add(queuedSeq);
      this.events.cut(queuedSeq);
    }
    this.nextTime = 0;
    this.playQueuedAudio();
  }

  close(): void {
    clearTimeout(this.timer);
    void this.audioContext.close();
  }

  private finishedTurns = new Set<number>();

  private queueFor(seq: number): TurnAudioQueue | undefined {
    if (this.finishedTurns.has(seq)) return undefined;
    let queue = this.queues.get(seq);
    if (!queue) {
      queue = { pending: [], final: false, started: false, playingSources: new Set(), lastChunkAt: 0 };
      this.queues.set(seq, queue);
    }
    return queue;
  }

  private finish(seq: number, queue: TurnAudioQueue): void {
    this.queues.delete(seq);
    this.finishedTurns.add(seq);
    if (queue.started) this.events.audioEnd(seq, performance.now());
  }

  private playQueuedAudio(): void {
    clearTimeout(this.timer);
    for (;;) {
      if (!this.queues.size) return;
      const seq = Math.min(...this.queues.keys());
      const queue = this.queues.get(seq)!;
      for (const pcm of queue.pending) this.schedule(seq, queue, pcm);
      queue.pending = [];
      if (queue.playingSources.size) return;
      const laterWaiting = [...this.queues].some(
        ([queuedSeq, laterQueue]) => queuedSeq > seq && laterQueue.pending.length,
      );
      const stalled = laterWaiting && performance.now() - queue.lastChunkAt > STALL_MS;
      if (queue.final || stalled) {
        this.finish(seq, queue);
        continue;
      }
      if (laterWaiting) this.timer = setTimeout(() => this.playQueuedAudio(), STALL_MS);
      return;
    }
  }

  private schedule(seq: number, queue: TurnAudioQueue, pcm: Int16Array): void {
    if (!pcm.length) return;
    const audioBuffer = this.audioContext.createBuffer(1, pcm.length, PLAYBACK_SAMPLE_RATE);
    audioBuffer.copyToChannel(pcm16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(this.gain);
    const startAt = Math.max(this.nextTime, this.audioContext.currentTime + 0.02);
    sourceNode.start(startAt);
    this.nextTime = startAt + audioBuffer.duration;
    queue.playingSources.add(sourceNode);
    if (!queue.started) {
      queue.started = true;
      this.events.firstAudio(seq, performance.now() + (startAt - this.audioContext.currentTime) * 1000);
    }
    sourceNode.onended = () => {
      queue.playingSources.delete(sourceNode);
      this.playQueuedAudio();
    };
  }
}
