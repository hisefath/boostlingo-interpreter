// Voice-to-voice transport (lld §5, hld §4): WebRTC straight to OpenAI Realtime with a short-lived client secret
// minted by our server; events on the "oai-events" data channel become turn updates and timing points.
import type { Lang, TurnText } from "../../shared/contracts.ts";
import { guessLang, otherLang } from "../lib.ts";
import type { Transport, TransportEvents } from "../session.ts";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const VAD_SILENCE_MS = 500; // matches turn_detection.silence_duration_ms in src/server/index.ts

// Shape of the data-channel events we read (fields are optional on purpose: we only trust what arrives).
interface OaiEvent {
  type: string;
  item_id?: string;
  response_id?: string;
  audio_end_ms?: number;
  delta?: string;
  transcript?: string;
  response?: { id?: string };
  error?: { message?: string };
}

export class RealtimeTransport implements Transport {
  private pc: RTCPeerConnection | null = null;
  private audio = new Audio();
  private remote: MediaStream | null = null;
  private mic: MediaStreamTrack | null = null;
  private t0 = 0;
  private echoGuard = true;
  private unmute: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private reconnected = false;
  private seq = 0;
  private current: string | null = null;
  private byResponse = new Map<string, string>();
  private src = new Map<string, string>();
  private tgt = new Map<string, string>();
  private input: MediaStream | null = null;
  private context: TurnText[] = [];
  private pair: [Lang, Lang] = ["en", "es"];

  constructor(private ev: TransportEvents) {
    this.audio.autoplay = true;
  }

  async start(input: MediaStream, context: TurnText[], pair: [Lang, Lang]): Promise<void> {
    this.input = input;
    this.context = context;
    this.pair = pair;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.pc?.close();
    this.mic?.stop();
    this.audio.srcObject = null;
  }

  output(): MediaStream | null {
    return this.remote;
  }

  setEchoGuard(on: boolean): void {
    this.echoGuard = on;
    if (!on && this.mic) this.mic.enabled = true;
  }

  private async connect(): Promise<void> {
    const r = await fetch("/api/realtime-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: this.pair, context: this.context }),
    });
    if (!r.ok) throw new Error(`realtime session failed (${r.status})`);
    const { value } = (await r.json()) as { value: string; expiresAt: number };

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (e) => {
      this.remote = e.streams[0] ?? new MediaStream([e.track]);
      this.audio.srcObject = this.remote;
    };
    this.mic?.stop();
    const track = this.input!.getAudioTracks()[0];
    if (!track) throw new Error("no audio input");
    this.mic = track.clone(); // own copy, so the echo guard can disable it without touching the caller's track
    pc.addTrack(this.mic);
    const dc = pc.createDataChannel("oai-events");
    dc.onopen = () => (this.t0 = performance.now());
    dc.onmessage = (e) => this.onEvent(JSON.parse(e.data as string) as OaiEvent);
    pc.onconnectionstatechange = () => {
      if (this.stopped || pc !== this.pc) return;
      if (pc.connectionState !== "failed" && pc.connectionState !== "disconnected") return;
      if (this.reconnected) return this.ev.error("voice-to-voice connection lost");
      this.reconnected = true;
      this.ev.notice("voice-to-voice connection lost, reconnecting…");
      pc.close();
      this.connect().then(
        () => this.ev.notice("reconnected"),
        () => this.ev.error("voice-to-voice connection lost; reconnect failed"),
      );
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await fetch(CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" },
    });
    if (!answer.ok) throw new Error(`OpenAI realtime call failed (${answer.status})`);
    await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
  }

  /** the turn an event belongs to; creates one when speech_started was missed */
  private turnFor(itemId?: string): string {
    if (itemId && this.src.has(itemId)) return itemId;
    if (itemId && !this.current) return this.newTurn(itemId);
    return this.current ?? this.newTurn(itemId ?? `rt-${this.seq}`);
  }

  private newTurn(id: string): string {
    this.current = id;
    this.src.set(id, "");
    this.tgt.set(id, "");
    this.ev.turn({
      turnId: id,
      seq: this.seq++,
      mode: "realtime",
      state: "hearing",
      from: this.pair[0],
      to: this.pair[1],
    });
    return id;
  }

  private setSrc(id: string, text: string): void {
    this.src.set(id, text);
    const from = guessLang(text, this.pair[0], this.pair);
    this.ev.turn({ turnId: id, srcText: text, from, to: otherLang(this.pair, from) });
  }

  private onEvent(e: OaiEvent): void {
    const now = performance.now();
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        this.newTurn(e.item_id ?? `rt-${this.seq}`);
        return;
      case "input_audio_buffer.speech_stopped": {
        const id = this.turnFor(e.item_id);
        // audio_end_ms counts from the session's audio start, which this page cannot see; anchor speech end to the
        // event's arrival minus the configured VAD silence wait (500 ms, server-side). Approximation, stated in the write-up.
        this.ev.timing(id, "speech_end", now - VAD_SILENCE_MS);
        this.ev.timing(id, "turn_detected", now);
        this.ev.turn({ turnId: id, state: "translating" });
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const id = this.turnFor(e.item_id);
        this.setSrc(id, (this.src.get(id) ?? "") + (e.delta ?? ""));
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = this.turnFor(e.item_id);
        const text = e.transcript ?? this.src.get(id) ?? "";
        this.setSrc(id, text);
        if (!text.trim()) this.ev.turn({ turnId: id, state: "empty" });
        return;
      }
      case "response.created":
        if (e.response?.id) this.byResponse.set(e.response.id, this.turnFor());
        return;
      case "response.output_audio_transcript.delta": {
        const id = this.byResponse.get(e.response_id ?? "") ?? this.turnFor();
        const text = (this.tgt.get(id) ?? "") + (e.delta ?? "");
        this.tgt.set(id, text);
        this.ev.turn({ turnId: id, tgtText: text, state: "speaking" });
        return;
      }
      case "output_audio_buffer.started": {
        const id = this.byResponse.get(e.response_id ?? "") ?? this.turnFor();
        this.ev.timing(id, "first_audio", now);
        if (this.echoGuard && this.mic) {
          this.mic.enabled = false;
          // never leave the mic muted if the stop event is lost (review A-R10)
          clearTimeout(this.unmute);
          this.unmute = setTimeout(() => this.mic && (this.mic.enabled = true), 15_000);
        }
        return;
      }
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const id = this.byResponse.get(e.response_id ?? "") ?? this.turnFor();
        clearTimeout(this.unmute);
        if (this.mic) this.mic.enabled = true;
        if (e.type === "output_audio_buffer.cleared") return this.ev.turn({ turnId: id, state: "cut" });
        this.ev.timing(id, "audio_end", now);
        this.ev.turn({ turnId: id, state: "done" });
        return;
      }
      case "error":
        clearTimeout(this.unmute);
        if (this.mic) this.mic.enabled = true;
        this.ev.error(e.error?.message ?? "realtime error", this.current ?? undefined);
        return;
    }
  }
}
