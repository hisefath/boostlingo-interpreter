// Cascade transport (lld §3, §5): WebSocket /cascade, mic PCM16 16 kHz up, events + seq-prefixed PCM16 24 kHz down.
import type { ClientMessage, LanguageCode, ServerMessage, TurnText } from "../../shared/contracts.ts";
import { captureAudioChunks } from "../audio-capture.ts";
import {
  clockOffsetMs,
  floatToPcm16,
  parseAudioFrame,
  resampleFloat32,
} from "../timing-and-audio-helpers.ts";
import { AudioPlayer } from "../audio-player.ts";
import type { Transport, TransportEvents } from "../session.ts";

const UPLOAD_SAMPLE_RATE = 16000;

export class CascadeTransport implements Transport {
  private socket: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private stopCapture: (() => void) | null = null;
  private clockOffsetMs = 0;
  private bestRoundTripMs = Infinity;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private reconnected = false;
  private echoGuard = true;
  private seqByTurnId = new Map<string, number>();
  private turnIdBySeq = new Map<number, string>();
  private context: TurnText[] = [];
  // A reconnect starts a new server pipeline whose seq and turn ids restart; offset them so they never collide.
  private connectionEpoch = 0;
  private seqOffset = 0;
  private maxSeq = 0;
  private pair: [LanguageCode, LanguageCode] = ["en", "es"];

  constructor(private events: TransportEvents) {}

  async start(input: MediaStream, context: TurnText[], pair: [LanguageCode, LanguageCode]): Promise<void> {
    this.context = context;
    this.pair = pair;
    const player = new AudioPlayer({
      firstAudio: (seq, atMs) =>
        this.turnIdBySeq.has(seq) && this.events.timing(this.turnIdBySeq.get(seq)!, "first_audio", atMs),
      audioEnd: (seq, atMs) =>
        this.turnIdBySeq.has(seq) && this.events.timing(this.turnIdBySeq.get(seq)!, "audio_end", atMs),
      cut: (seq) =>
        this.turnIdBySeq.has(seq) && this.events.turn({ turnId: this.turnIdBySeq.get(seq)!, state: "cut" }),
    });
    this.player = player;
    await player.audioContext.resume();
    await this.connect();
    const samplesPerFrame = Math.round(player.audioContext.sampleRate / 50); // 20 ms
    let pendingSamples: number[] = [];
    this.stopCapture = await captureAudioChunks(player.audioContext, input, (chunk) => {
      for (const sample of chunk) pendingSamples.push(sample);
      while (pendingSamples.length >= samplesPerFrame) {
        const frame = resampleFloat32(
          Float32Array.from(pendingSamples.splice(0, samplesPerFrame)),
          player.audioContext.sampleRate,
          UPLOAD_SAMPLE_RATE,
        );
        // echo guard: send silence (keeps the STT clock running) while our own audio plays
        const pcm = this.echoGuard && player.playing ? new Int16Array(frame.length) : floatToPcm16(frame);
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(pcm as Int16Array<ArrayBuffer>);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.pingTimer);
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: "stop" });
    this.socket?.close();
    this.stopCapture?.();
    this.player?.close();
  }

  output(): MediaStream | null {
    return this.player?.stream ?? null;
  }

  setEchoGuard(on: boolean): void {
    this.echoGuard = on;
  }

  private send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/cascade`,
      );
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let opened = false;
      socket.onopen = () => {
        opened = true;
        this.send({ type: "start", pair: this.pair, context: this.context });
        const ping = () => this.send({ type: "ping", t: performance.now() });
        ping();
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(ping, 5000);
        resolve();
      };
      socket.onmessage = (event) =>
        typeof event.data === "string"
          ? this.onJsonMessage(JSON.parse(event.data))
          : this.onAudioFrame(event.data);
      socket.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.stopped) return;
        if (!opened) return reject(new Error("could not connect to the cascade server"));
        if (this.reconnected) return this.events.error("cascade connection lost");
        this.reconnected = true;
        this.connectionEpoch++;
        this.seqOffset = this.maxSeq;
        this.events.notice("cascade connection lost, reconnecting…");
        this.connect().then(
          () => this.events.notice("reconnected"),
          () => this.events.error("cascade connection lost; reconnect failed"),
        );
      };
    });
  }

  private onAudioFrame(frame: ArrayBuffer): void {
    const { seq, pcm } = parseAudioFrame(frame);
    this.player?.push(seq + this.seqOffset, pcm);
  }

  private onJsonMessage(message: ServerMessage): void {
    const now = performance.now();
    switch (message.type) {
      case "pong": {
        const roundTripMs = now - message.t;
        if (roundTripMs <= this.bestRoundTripMs) {
          this.bestRoundTripMs = roundTripMs;
          this.clockOffsetMs = clockOffsetMs(message.t, message.serverT, now);
        }
        return;
      }
      case "turn": {
        const { type: _type, ...raw } = message;
        const update = {
          ...raw,
          seq: raw.seq + this.seqOffset,
          turnId: `${this.connectionEpoch}-${raw.turnId}`,
        };
        this.maxSeq = Math.max(this.maxSeq, update.seq);
        this.seqByTurnId.set(update.turnId, update.seq);
        this.turnIdBySeq.set(update.seq, update.turnId);
        this.events.turn(update);
        this.player?.setState(update.seq, update.state);
        return;
      }
      case "timing": {
        const turnId = `${this.connectionEpoch}-${message.turnId}`;
        this.events.timing(turnId, message.point, message.serverT - this.clockOffsetMs, message.vendor);
        const seq = this.seqByTurnId.get(turnId);
        // barge-in only with headphones: with the echo guard on, the mic is silent while we play, so a new
        // speech end then belongs to speech from before playback. ponytail: no per-turn time comparison.
        const ended = message.point === "speech_end" || message.point === "stt_final";
        if (seq !== undefined && ended && !this.echoGuard) this.player?.bargeIn(seq);
        return;
      }
      case "error":
        this.events.error(`${message.stage} ${message.kind}: ${message.message}`);
        return;
    }
  }
}
