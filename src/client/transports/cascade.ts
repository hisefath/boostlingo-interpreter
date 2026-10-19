// Cascade transport (lld §3, §5): WebSocket /cascade, mic PCM16 16 kHz up, events + seq-prefixed PCM16 24 kHz down.
import type { ClientMsg, Lang, ServerMsg, TurnText } from "../../shared/contracts.ts";
import { capture } from "../capture.ts";
import { clockOffset, floatToPcm16, parseAudioFrame, resample } from "../lib.ts";
import { Player } from "../player.ts";
import type { Transport, TransportEvents } from "../session.ts";

const UP_RATE = 16000;

export class CascadeTransport implements Transport {
  private ws: WebSocket | null = null;
  private player: Player | null = null;
  private stopCapture: (() => void) | null = null;
  private offset = 0;
  private bestRtt = Infinity;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private reconnected = false;
  private echoGuard = true;
  private seqOf = new Map<string, number>();
  private idOf = new Map<number, string>();
  private context: TurnText[] = [];
  private pair: [Lang, Lang] = ["en", "es"];

  constructor(private ev: TransportEvents) {}

  async start(input: MediaStream, context: TurnText[], pair: [Lang, Lang]): Promise<void> {
    this.context = context;
    this.pair = pair;
    const player = new Player({
      firstAudio: (seq, t) => this.idOf.has(seq) && this.ev.timing(this.idOf.get(seq)!, "first_audio", t),
      audioEnd: (seq, t) => this.idOf.has(seq) && this.ev.timing(this.idOf.get(seq)!, "audio_end", t),
      cut: (seq) => this.idOf.has(seq) && this.ev.turn({ turnId: this.idOf.get(seq)!, state: "cut" }),
    });
    this.player = player;
    await player.ctx.resume();
    await this.connect();
    const block = Math.round(player.ctx.sampleRate / 50); // 20 ms
    let acc: number[] = [];
    this.stopCapture = await capture(player.ctx, input, (chunk) => {
      for (const v of chunk) acc.push(v);
      while (acc.length >= block) {
        const frame = resample(Float32Array.from(acc.splice(0, block)), player.ctx.sampleRate, UP_RATE);
        // echo guard: send silence (keeps the STT clock running) while our own audio plays
        const pcm = this.echoGuard && player.playing ? new Int16Array(frame.length) : floatToPcm16(frame);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm as Int16Array<ArrayBuffer>);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.pinger);
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "stop" });
    this.ws?.close();
    this.stopCapture?.();
    this.player?.close();
  }

  output(): MediaStream | null {
    return this.player?.stream ?? null;
  }

  /** PCM16 24 kHz audio received for a turn (eval recording) */
  recorded(turnId: string): Int16Array[] {
    const seq = this.seqOf.get(turnId);
    return seq === undefined || !this.player ? [] : this.player.recorded(seq);
  }

  setEchoGuard(on: boolean): void {
    this.echoGuard = on;
  }

  private send(m: ClientMsg): void {
    this.ws?.send(JSON.stringify(m));
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/cascade`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.send({ type: "start", pair: this.pair, context: this.context });
        const ping = () => this.send({ type: "ping", t: performance.now() });
        ping();
        clearInterval(this.pinger);
        this.pinger = setInterval(ping, 5000);
        resolve();
      };
      ws.onmessage = (e) =>
        typeof e.data === "string" ? this.onJson(JSON.parse(e.data)) : this.onAudio(e.data);
      ws.onclose = () => {
        clearInterval(this.pinger);
        if (this.stopped) return;
        if (!opened) return reject(new Error("could not connect to the cascade server"));
        if (this.reconnected) return this.ev.error("cascade connection lost");
        this.reconnected = true;
        this.ev.notice("cascade connection lost, reconnecting…");
        this.connect().then(
          () => this.ev.notice("reconnected"),
          () => this.ev.error("cascade connection lost; reconnect failed"),
        );
      };
    });
  }

  private onAudio(buf: ArrayBuffer): void {
    const { seq, pcm } = parseAudioFrame(buf);
    this.player?.push(seq, pcm);
  }

  private onJson(m: ServerMsg): void {
    const now = performance.now();
    switch (m.type) {
      case "pong": {
        const rtt = now - m.t;
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = clockOffset(m.t, m.serverT, now);
        }
        return;
      }
      case "turn": {
        const { type: _type, ...u } = m;
        this.seqOf.set(u.turnId, u.seq);
        this.idOf.set(u.seq, u.turnId);
        this.ev.turn(u);
        this.player?.setState(u.seq, u.state);
        return;
      }
      case "timing": {
        this.ev.timing(m.turnId, m.point, m.serverT - this.offset, m.vendor);
        const seq = this.seqOf.get(m.turnId);
        // barge-in only with headphones: with the echo guard on, the mic is silent while we play, so a new
        // speech end then belongs to speech from before playback. ponytail: no per-turn time comparison.
        const ended = m.point === "speech_end" || m.point === "stt_final";
        if (seq !== undefined && ended && !this.echoGuard) this.player?.bargeIn(seq);
        return;
      }
      case "error":
        this.ev.error(`${m.stage} ${m.kind}: ${m.message}`);
        return;
    }
  }
}
