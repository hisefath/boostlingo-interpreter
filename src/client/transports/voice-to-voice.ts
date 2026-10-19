// Voice-to-voice transport (lld §5, hld §4): WebRTC straight to OpenAI Realtime with a short-lived client secret
// minted by our server; events on the "oai-events" data channel become turn updates and timing points.
import type { LanguageCode, TurnText } from "../../shared/contracts.ts";
import { guessLanguageWithDefaults, otherLanguage } from "../timing-and-audio-helpers.ts";
import type { Transport, TransportEvents } from "../session.ts";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const VAD_SILENCE_MS = 500; // matches turn_detection.silence_duration_ms in src/server/index.ts

// Shape of the data-channel events we read (fields are optional on purpose: we only trust what arrives).
interface OpenAiRealtimeEvent {
  type: string;
  item_id?: string;
  response_id?: string;
  audio_end_ms?: number;
  delta?: string;
  transcript?: string;
  response?: { id?: string };
  error?: { message?: string };
}

export class VoiceToVoiceTransport implements Transport {
  private peerConnection: RTCPeerConnection | null = null;
  private audio = new Audio();
  private remoteStream: MediaStream | null = null;
  private microphoneTrack: MediaStreamTrack | null = null;
  private dataChannelOpenedAt = 0;
  private echoGuard = true;
  private unmuteTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private reconnected = false;
  private seq = 0;
  private currentTurnId: string | null = null;
  private turnIdByResponseId = new Map<string, string>();
  private sourceTextByTurn = new Map<string, string>();
  private targetTextByTurn = new Map<string, string>();
  private input: MediaStream | null = null;
  private context: TurnText[] = [];
  private pair: [LanguageCode, LanguageCode] = ["en", "es"];

  constructor(private events: TransportEvents) {
    this.audio.autoplay = true;
  }

  async start(input: MediaStream, context: TurnText[], pair: [LanguageCode, LanguageCode]): Promise<void> {
    this.input = input;
    this.context = context;
    this.pair = pair;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.peerConnection?.close();
    this.microphoneTrack?.stop();
    this.audio.srcObject = null;
  }

  output(): MediaStream | null {
    return this.remoteStream;
  }

  setEchoGuard(on: boolean): void {
    this.echoGuard = on;
    if (!on && this.microphoneTrack) this.microphoneTrack.enabled = true;
  }

  private async connect(): Promise<void> {
    const response = await fetch("/api/realtime-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: this.pair, context: this.context }),
    });
    if (!response.ok) throw new Error(`realtime session failed (${response.status})`);
    const { value } = (await response.json()) as { value: string; expiresAt: number };

    const peerConnection = new RTCPeerConnection();
    this.peerConnection = peerConnection;
    peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      this.audio.srcObject = this.remoteStream;
    };
    this.microphoneTrack?.stop();
    const track = this.input!.getAudioTracks()[0];
    if (!track) throw new Error("no audio input");
    this.microphoneTrack = track.clone(); // own copy, so the echo guard can disable it without touching the caller's track
    peerConnection.addTrack(this.microphoneTrack);
    const dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => (this.dataChannelOpenedAt = performance.now());
    dataChannel.onmessage = (event) =>
      this.onRealtimeEvent(JSON.parse(event.data as string) as OpenAiRealtimeEvent);
    peerConnection.onconnectionstatechange = () => {
      if (this.stopped || peerConnection !== this.peerConnection) return;
      if (peerConnection.connectionState !== "failed" && peerConnection.connectionState !== "disconnected")
        return;
      if (this.reconnected) return this.events.error("voice-to-voice connection lost");
      this.reconnected = true;
      this.events.notice("voice-to-voice connection lost, reconnecting…");
      peerConnection.close();
      this.connect().then(
        () => this.events.notice("reconnected"),
        () => this.events.error("voice-to-voice connection lost; reconnect failed"),
      );
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const answer = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" },
    });
    if (!answer.ok) throw new Error(`OpenAI realtime call failed (${answer.status})`);
    await peerConnection.setRemoteDescription({ type: "answer", sdp: await answer.text() });
  }

  /** the turn an event belongs to; creates one when speech_started was missed */
  private turnIdFor(itemId?: string): string {
    if (itemId && this.sourceTextByTurn.has(itemId)) return itemId;
    if (itemId && !this.currentTurnId) return this.newTurn(itemId);
    return this.currentTurnId ?? this.newTurn(itemId ?? `rt-${this.seq}`);
  }

  private newTurn(id: string): string {
    this.currentTurnId = id;
    this.sourceTextByTurn.set(id, "");
    this.targetTextByTurn.set(id, "");
    this.events.turn({
      turnId: id,
      seq: this.seq++,
      mode: "realtime",
      state: "hearing",
      from: this.pair[0],
      to: this.pair[1],
    });
    return id;
  }

  private setSourceText(id: string, text: string): void {
    this.sourceTextByTurn.set(id, text);
    const from = guessLanguageWithDefaults(text, this.pair[0], this.pair);
    this.events.turn({ turnId: id, srcText: text, from, to: otherLanguage(this.pair, from) });
  }

  private onRealtimeEvent(event: OpenAiRealtimeEvent): void {
    const now = performance.now();
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.newTurn(event.item_id ?? `rt-${this.seq}`);
        return;
      case "input_audio_buffer.speech_stopped": {
        const id = this.turnIdFor(event.item_id);
        // audio_end_ms counts from the session's audio start, which this page cannot see; anchor speech end to the
        // event's arrival minus the configured VAD silence wait (500 ms, server-side). Approximation, stated in the write-up.
        this.events.timing(id, "speech_end", now - VAD_SILENCE_MS);
        this.events.timing(id, "turn_detected", now);
        this.events.turn({ turnId: id, state: "translating" });
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const id = this.turnIdFor(event.item_id);
        this.setSourceText(id, (this.sourceTextByTurn.get(id) ?? "") + (event.delta ?? ""));
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = this.turnIdFor(event.item_id);
        const text = event.transcript ?? this.sourceTextByTurn.get(id) ?? "";
        this.setSourceText(id, text);
        if (!text.trim()) this.events.turn({ turnId: id, state: "empty" });
        return;
      }
      case "response.created":
        if (event.response?.id) this.turnIdByResponseId.set(event.response.id, this.turnIdFor());
        return;
      case "response.output_audio_transcript.delta": {
        const id = this.turnIdByResponseId.get(event.response_id ?? "") ?? this.turnIdFor();
        const text = (this.targetTextByTurn.get(id) ?? "") + (event.delta ?? "");
        this.targetTextByTurn.set(id, text);
        this.events.turn({ turnId: id, tgtText: text, state: "speaking" });
        return;
      }
      case "output_audio_buffer.started": {
        const id = this.turnIdByResponseId.get(event.response_id ?? "") ?? this.turnIdFor();
        this.events.timing(id, "first_audio", now);
        if (this.echoGuard && this.microphoneTrack) {
          this.microphoneTrack.enabled = false;
          // never leave the mic muted if the stop event is lost (review A-R10)
          clearTimeout(this.unmuteTimer);
          this.unmuteTimer = setTimeout(
            () => this.microphoneTrack && (this.microphoneTrack.enabled = true),
            15_000,
          );
        }
        return;
      }
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const id = this.turnIdByResponseId.get(event.response_id ?? "") ?? this.turnIdFor();
        clearTimeout(this.unmuteTimer);
        if (this.microphoneTrack) this.microphoneTrack.enabled = true;
        if (event.type === "output_audio_buffer.cleared")
          return this.events.turn({ turnId: id, state: "cut" });
        this.events.timing(id, "audio_end", now);
        this.events.turn({ turnId: id, state: "done" });
        return;
      }
      case "error":
        clearTimeout(this.unmuteTimer);
        if (this.microphoneTrack) this.microphoneTrack.enabled = true;
        this.events.error(event.error?.message ?? "realtime error", this.currentTurnId ?? undefined);
        return;
    }
  }
}
