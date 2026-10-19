// Stage contracts (docs/architecture/lld.md §1). Every vendor adapter implements one of these;
// swapping a vendor = one new adapter file + one registry line.

export type Lang = "en" | "es";
export type Stage = "stt" | "translate" | "tts";
export type ErrorKind = "rate_limited" | "timeout" | "empty" | "disconnected" | "failed";
export type Mode = "realtime" | "cascade";

export class ProviderError extends Error {
  constructor(
    readonly stage: Stage,
    readonly kind: ErrorKind,
    message = `${stage} ${kind}`,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

// ---- STT: audio in, partial/final text out -------------------------------------------------------------
export interface SttFinal {
  segmentId: string;
  text: string;
  lang: Lang;
  /** true end of speech, ms on the pipeline clock (INV-2) */
  endMs: number;
}
export interface SttHandlers {
  onPartial(p: { text: string; lang: Lang }): void;
  onFinal(f: SttFinal): void;
  onError(e: ProviderError): void;
}
export interface SttStream {
  /** PCM16 mono 16 kHz */
  push(pcm: Int16Array): void;
  close(): void;
}
export interface SttProvider {
  readonly name: string;
  open(opts: { languages: Lang[] } & SttHandlers): SttStream;
}

// ---- Translate: settled source text in, streamed target text out ----------------------------------------
export interface TurnText {
  srcText: string;
  tgtText: string;
  from: Lang;
  to: Lang;
}
export interface TranslateRequest {
  turnId: string;
  text: string;
  from: Lang;
  to: Lang;
  /** recent turns, oldest first (INV-6) */
  context: TurnText[];
}
export interface Translator {
  readonly name: string;
  translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<string>;
}

// ---- TTS: text segment in, PCM16 24 kHz chunks out -------------------------------------------------------
export interface TtsRequest {
  turnId: string;
  segmentIdx: number;
  text: string;
  lang: Lang;
}
export interface Tts {
  readonly name: string;
  speak(req: TtsRequest, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

// ---- Turns and timing (shared by both modes for display) -------------------------------------------------
export type TurnState = "hearing" | "translating" | "speaking" | "done" | "failed" | "empty" | "cut";

export type TimingPoint =
  | "speech_end"
  | "turn_detected"
  | "stt_final"
  | "first_translation"
  | "first_tts_byte"
  | "first_audio"
  | "audio_end";

export interface TurnUpdate {
  turnId: string;
  seq: number;
  mode: Mode;
  state: TurnState;
  from: Lang;
  to: Lang;
  srcText?: string;
  tgtText?: string;
  /** e.g. "translate timeout" when state is failed */
  reason?: string;
}

// ---- Wire protocol: browser <-> server WebSocket /cascade (lld.md §3) -------------------------------------
export type ClientMsg =
  { type: "start"; pair: [Lang, Lang]; context: TurnText[] } | { type: "stop" } | { type: "ping"; t: number };

export type ServerMsg =
  | { type: "pong"; t: number; serverT: number }
  | ({ type: "turn" } & TurnUpdate)
  | { type: "timing"; turnId: string; point: TimingPoint; serverT: number; vendor?: string }
  | { type: "error"; stage: Stage | "session"; kind: ErrorKind; message: string };
