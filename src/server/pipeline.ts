// Cascade pipeline: STT finals -> streamed translation -> settled segments -> TTS (lld.md §1–§2, hld.md INV-3/5/6).
import { ProviderError } from "../shared/contracts.ts";
import type {
  Lang,
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
  turn(u: TurnUpdate): void;
  audio(seq: number, chunk: Uint8Array): void;
  timing(turnId: string, point: TimingPoint, serverT: number, vendor?: string): void;
  error?(e: ProviderError): void;
}

export interface PipelineOptions {
  stt: SttProvider;
  translator: Translator;
  tts: Tts;
  pair: [Lang, Lang];
  limits: { translateMs: number; ttsMs: number };
  events: PipelineEvents;
  context?: TurnText[];
}

export interface Pipeline {
  pushAudio(pcm: Int16Array): void;
  setContext(ctx: TurnText[]): void;
  stop(): void;
}

const CONTEXT_TURNS = 5;
/** A clause/sentence end followed by whitespace: everything up to it is settled (FR-025). */
const BOUNDARY = /[,.?!;:](?=\s)/g;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createPipeline(o: PipelineOptions): Pipeline {
  let context = [...(o.context ?? [])];
  let seq = 0;
  let stopped = false;
  const live = new Set<AbortController>();
  const other = (l: Lang): Lang => (l === o.pair[0] ? o.pair[1] : o.pair[0]);

  const stream = o.stt.open({
    languages: [...o.pair],
    onPartial(p) {
      if (stopped) return;
      const n = seq + 1;
      o.events.turn({
        turnId: `t${n}`,
        seq: n,
        mode: "cascade",
        state: "hearing",
        from: p.lang,
        to: other(p.lang),
        srcText: p.text,
      });
    },
    onFinal(f) {
      if (!stopped) void runTurn(f);
    },
    onError(e) {
      o.events.error?.(e);
    },
  });

  async function runTurn(f: SttFinal) {
    const n = ++seq;
    const turnId = `t${n}`;
    const from = f.lang;
    const to = other(from);
    const srcText = f.text.trim();
    const mine = new Set<AbortController>();
    let dead = false; // failed or finished: every later result for this turn is dropped (INV-3)
    let state: TurnState = "translating";
    let tgt = "";

    const emit = (s: TurnState, extra: Partial<TurnUpdate> = {}) => {
      if (dead || stopped) return;
      state = s;
      o.events.turn({ turnId, seq: n, mode: "cascade", state: s, from, to, srcText, ...extra });
    };
    const fail = (e: unknown, st: Stage) => {
      if (dead) return;
      const reason = e instanceof ProviderError ? `${e.stage} ${e.kind}` : `${st} failed`;
      emit("failed", { reason, tgtText: tgt.trim() || undefined });
      dead = true;
      for (const ac of mine) ac.abort();
    };
    /** Runs one stage call with its own AbortController and timeout; the race fires even if fn ignores the signal. */
    const stage = async (st: Stage, ms: number, fn: (signal: AbortSignal) => Promise<void>) => {
      const ac = new AbortController();
      mine.add(ac);
      live.add(ac);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ac.abort();
          rej(new ProviderError(st, "timeout"));
        }, ms);
      });
      try {
        await Promise.race([fn(ac.signal), timeout]);
      } finally {
        clearTimeout(timer);
        mine.delete(ac);
        live.delete(ac);
      }
    };

    o.events.timing(turnId, "speech_end", f.endMs, o.stt.name);
    o.events.timing(turnId, "stt_final", Date.now(), o.stt.name);
    if (!srcText) {
      emit("empty");
      dead = true;
      return;
    }
    emit("translating");

    // TTS: settled segments are spoken one after another, in order, while translation continues (FR-004).
    let speaking = Promise.resolve();
    let segIdx = 0;
    let firstByte = false;
    const speak = (text: string) => {
      const segmentIdx = segIdx++;
      speaking = speaking.then(async () => {
        if (dead || stopped) return;
        try {
          await stage("tts", o.limits.ttsMs, async (signal) => {
            for await (const chunk of o.tts.speak({ turnId, segmentIdx, text, lang: to }, signal)) {
              if (dead || stopped) return;
              if (!firstByte) {
                firstByte = true;
                o.events.timing(turnId, "first_tts_byte", Date.now(), o.tts.name);
                emit("speaking", { tgtText: tgt.trim() });
              }
              o.events.audio(n, chunk);
            }
          });
        } catch (e) {
          fail(e, "tts");
        }
      });
    };

    let buf = "";
    const cut = (end: boolean) => {
      let at = end ? buf.length : -1;
      if (!end) for (const m of buf.matchAll(BOUNDARY)) at = m.index + 1;
      if (at <= 0) return;
      const seg = buf.slice(0, at).trim();
      buf = buf.slice(at);
      if (seg) speak(seg);
    };

    const req = { turnId, text: srcText, from, to, context: context.slice(-CONTEXT_TURNS) };
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await stage("translate", o.limits.translateMs, async (signal) => {
            for await (const delta of o.translator.translate(req, signal)) {
              if (dead || stopped) return;
              if (!tgt) o.events.timing(turnId, "first_translation", Date.now(), o.translator.name);
              tgt += delta;
              buf += delta;
              emit(state, { tgtText: tgt.trim() });
              cut(false);
            }
          });
          break;
        } catch (e) {
          // FR-012: one retry after the advised wait, only if nothing was streamed yet.
          if (e instanceof ProviderError && e.kind === "rate_limited" && attempt === 0 && !tgt && !dead) {
            await sleep(e.retryAfterMs ?? 1000);
            continue;
          }
          throw e;
        }
      }
      if (dead || stopped) return;
      cut(true);
      if (!tgt.trim()) throw new ProviderError("translate", "empty");
    } catch (e) {
      fail(e, "translate");
      return;
    }

    await speaking;
    if (dead || stopped) return;
    emit("done", { tgtText: tgt.trim() });
    dead = true;
    context.push({ srcText, tgtText: tgt.trim(), from, to });
    context = context.slice(-CONTEXT_TURNS);
  }

  return {
    pushAudio(pcm) {
      if (!stopped) stream.push(pcm);
    },
    setContext(ctx) {
      context = [...ctx];
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stream.close();
      for (const ac of live) ac.abort();
    },
  };
}
