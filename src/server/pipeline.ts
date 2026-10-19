// Cascade pipeline: STT finals -> streamed translation -> settled segments -> TTS (lld.md §1–§2, hld.md INV-3/5/6).
import { ProviderError } from "../shared/contracts.ts";
import type {
  LanguageCode,
  SttFinal,
  SttProvider,
  Stage,
  TimingPoint,
  Translator,
  Tts,
  TurnState,
  TurnText,
  TurnUpdate,
} from "../shared/contracts.ts";

export interface PipelineEvents {
  turn(update: TurnUpdate): void;
  audio(seq: number, chunk: Uint8Array): void;
  timing(turnId: string, point: TimingPoint, serverT: number, vendor?: string): void;
  error?(error: ProviderError): void;
}

export interface PipelineOptions {
  stt: SttProvider;
  translator: Translator;
  tts: Tts;
  pair: [LanguageCode, LanguageCode];
  /** idle timeouts per stage: a stage fails when it produces nothing for this long */
  limits: { translateMs: number; ttsMs: number };
  events: PipelineEvents;
  context?: TurnText[];
}

export interface Pipeline {
  pushAudio(pcm: Int16Array): void;
  setContext(context: TurnText[]): void;
  stop(): void;
}

const CONTEXT_TURNS = 5;
/** A clause/sentence end followed by whitespace: everything up to it is settled (FR-025). */
const SETTLED_TEXT_BOUNDARY = /[,.?!;:](?=\s)/g;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPipeline(options: PipelineOptions): Pipeline {
  let context = [...(options.context ?? [])];
  let seq = 0;
  let stopped = false;
  const activeControllers = new Set<AbortController>();
  const otherLanguage = (language: LanguageCode): LanguageCode =>
    language === options.pair[0] ? options.pair[1] : options.pair[0];

  const stream = options.stt.open({
    languages: [...options.pair],
    onPartial(partial) {
      if (stopped) return;
      const nextSeq = seq + 1;
      options.events.turn({
        turnId: `t${nextSeq}`,
        seq: nextSeq,
        mode: "cascade",
        state: "hearing",
        from: partial.lang,
        to: otherLanguage(partial.lang),
        srcText: partial.text,
      });
    },
    onFinal(final) {
      if (!stopped) void runTurn(final);
    },
    onError(error) {
      options.events.error?.(error);
    },
  });

  async function runTurn(final: SttFinal) {
    const turnSeq = ++seq;
    const turnId = `t${turnSeq}`;
    const from = final.lang;
    const to = otherLanguage(from);
    const srcText = final.text.trim();
    const turnControllers = new Set<AbortController>();
    let turnClosed = false; // failed or finished: every later result for this turn is dropped (INV-3)
    let state: TurnState = "translating";
    let targetText = "";

    const emit = (nextState: TurnState, extra: Partial<TurnUpdate> = {}) => {
      if (turnClosed || stopped) return;
      state = nextState;
      options.events.turn({
        turnId,
        seq: turnSeq,
        mode: "cascade",
        state: nextState,
        from,
        to,
        srcText,
        ...extra,
      });
    };
    const fail = (error: unknown, stage: Stage) => {
      if (turnClosed) return;
      const reason = error instanceof ProviderError ? `${error.stage} ${error.kind}` : `${stage} failed`;
      emit("failed", { reason, tgtText: targetText.trim() || undefined });
      turnClosed = true;
      for (const controller of turnControllers) controller.abort();
    };
    /** Runs one stage call with its own AbortController and an idle timeout: the stage fails only when it
     * produces nothing for `idleTimeoutMs` (FR-013); `resetIdleTimer()` on every delta/chunk re-arms it. The race
     * fires even if `run` ignores the signal. */
    const runStage = async (
      stage: Stage,
      idleTimeoutMs: number,
      run: (signal: AbortSignal, resetIdleTimer: () => void) => Promise<void>,
    ) => {
      const controller = new AbortController();
      turnControllers.add(controller);
      activeControllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let reject!: (error: unknown) => void;
      const timeout = new Promise<never>((_, rejectTimeout) => (reject = rejectTimeout));
      const resetIdleTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderError(stage, "timeout"));
        }, idleTimeoutMs);
      };
      resetIdleTimer();
      try {
        await Promise.race([run(controller.signal, resetIdleTimer), timeout]);
      } finally {
        clearTimeout(timer);
        turnControllers.delete(controller);
        activeControllers.delete(controller);
      }
    };

    options.events.timing(turnId, "speech_end", final.endMs, options.stt.name);
    // In the cascade the final transcript arriving IS the end-of-turn signal (HLD §4: turn-detection wait).
    options.events.timing(turnId, "turn_detected", Date.now(), options.stt.name);
    options.events.timing(turnId, "stt_final", Date.now(), options.stt.name);
    if (!srcText) {
      emit("empty");
      turnClosed = true;
      return;
    }
    emit("translating");

    // TTS: settled segments are spoken one after another, in order, while translation continues (FR-004).
    let speaking = Promise.resolve();
    let nextSegmentIndex = 0;
    let firstByte = false;
    const speak = (text: string) => {
      const segmentIndex = nextSegmentIndex++;
      speaking = speaking.then(async () => {
        if (turnClosed || stopped) return;
        try {
          await runStage("tts", options.limits.ttsMs, async (signal, resetIdleTimer) => {
            for await (const chunk of options.tts.speak({ turnId, segmentIndex, text, lang: to }, signal)) {
              if (turnClosed || stopped) return;
              resetIdleTimer();
              if (!firstByte) {
                firstByte = true;
                options.events.timing(turnId, "first_tts_byte", Date.now(), options.tts.name);
                emit("speaking", { tgtText: targetText.trim() });
              }
              options.events.audio(turnSeq, chunk);
            }
          });
        } catch (e) {
          fail(e, "tts");
        }
      });
    };

    let unspokenText = "";
    /** Speaks the translated text up to its last settled boundary (or all of it once translation is final). */
    const speakSettledText = (isFinal: boolean) => {
      let cutAt = isFinal ? unspokenText.length : -1;
      if (!isFinal)
        for (const boundaryMatch of unspokenText.matchAll(SETTLED_TEXT_BOUNDARY))
          cutAt = boundaryMatch.index + 1;
      if (cutAt <= 0) return;
      const segment = unspokenText.slice(0, cutAt).trim();
      unspokenText = unspokenText.slice(cutAt);
      if (segment) speak(segment);
    };

    const request = { turnId, text: srcText, from, to, context: context.slice(-CONTEXT_TURNS) };
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await runStage("translate", options.limits.translateMs, async (signal, resetIdleTimer) => {
            for await (const delta of options.translator.translate(request, signal)) {
              if (turnClosed || stopped) return;
              resetIdleTimer();
              if (!targetText)
                options.events.timing(turnId, "first_translation", Date.now(), options.translator.name);
              targetText += delta;
              unspokenText += delta;
              emit(state, { tgtText: targetText.trim() });
              speakSettledText(false);
            }
          });
          break;
        } catch (e) {
          // FR-012: one retry after the advised wait, only if nothing was streamed yet.
          if (
            e instanceof ProviderError &&
            e.kind === "rate_limited" &&
            attempt === 0 &&
            !targetText &&
            !turnClosed
          ) {
            const wait = Math.min(e.retryAfterMs ?? 1000, options.limits.translateMs);
            options.events.error?.(
              new ProviderError(
                "translate",
                "rate_limited",
                `translation rate-limited, retrying in ${wait} ms`,
              ),
            );
            await sleep(wait);
            continue;
          }
          throw e;
        }
      }
      if (turnClosed || stopped) return;
      speakSettledText(true);
      if (!targetText.trim()) throw new ProviderError("translate", "empty");
    } catch (e) {
      fail(e, "translate");
      return;
    }

    await speaking;
    if (turnClosed || stopped) return;
    emit("done", { tgtText: targetText.trim() });
    turnClosed = true;
    context.push({ srcText, tgtText: targetText.trim(), from, to });
    context = context.slice(-CONTEXT_TURNS);
  }

  return {
    pushAudio(pcm) {
      if (!stopped) stream.push(pcm);
    },
    setContext(newContext) {
      context = [...newContext];
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stream.close();
      for (const controller of activeControllers) controller.abort();
    },
  };
}
