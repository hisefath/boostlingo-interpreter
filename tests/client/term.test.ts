import { describe, expect, it } from "vitest";
import { modeSummary } from "../../src/client/lib.ts";
import {
  headerLine,
  plain,
  resultLine,
  summaryRow,
  timingLine,
  WIDTH,
  type Tok,
  type TokKind,
} from "../../src/client/term.ts";

const at = new Date(2026, 9, 18, 23, 41, 2, 120).getTime();
const tok = (toks: Tok[], kind: TokKind) => toks.find((t) => t.kind === kind)!;
const noteCol = (toks: Tok[]) => plain(toks.slice(0, -1)).length;

const FULL = {
  speech_end: 1000,
  turn_detected: 1200,
  stt_final: 1312,
  first_translation: 1700,
  first_tts_byte: 2000,
  first_audio: 2100,
  audio_end: 4000,
};

describe("timingLine", () => {
  it("tokenises clock, mode, turn badge, readable event, friendly vendor and delta", () => {
    const t = timingLine(at, "cascade", 2, "stt_final", "deepgram", 312);
    expect(tok(t, "time").text.trim()).toBe("23:41:02.120");
    expect(tok(t, "mode")).toEqual({ kind: "mode", text: "cascade", tone: "cascade" });
    expect(tok(t, "turn").text).toBe(" t3 ");
    expect(tok(t, "event").text.trim()).toBe("transcript");
    expect(tok(t, "vendor").text.trim()).toBe("Deepgram");
    expect(tok(t, "value").text).toBe("  +312");
    expect(tok(t, "unit").text).toBe("ms");
    expect(timingLine(at, "realtime", 0, "first_audio").find((x) => x.kind === "mode")?.tone).toBe(
      "realtime",
    );
  });

  it("pads every column to its width so lines align with the header", () => {
    const lines = [
      headerLine(),
      timingLine(at, "cascade", 2, "first_translation", "openai", 12345),
      timingLine(at, "realtime", 11, "speech_end"),
      resultLine(at, "cascade", 2, "failed", {}, "translate timeout"),
    ];
    // same token layout everywhere, and every column starts at the same character offset
    const offsets = (l: Tok[]) => l.map((_, i) => plain(l.slice(0, i)).length);
    for (const l of lines) expect(offsets(l)).toEqual(offsets(lines[0]));
    expect(new Set(lines.map(noteCol)).size).toBe(1);
    expect(noteCol(lines[0])).toBe(
      Object.values(WIDTH).reduce((a, b) => a + b, 0) + 2 * 6 + 1 * 2, // six 2-space gaps, two 1-space gaps
    );
    const l = lines[1];
    expect(tok(l, "time").text).toHaveLength(WIDTH.time);
    expect(tok(l, "mode").text).toHaveLength(WIDTH.mode);
    expect(tok(l, "turn").text).toHaveLength(WIDTH.turn);
    expect(tok(l, "event").text).toHaveLength(WIDTH.event);
    expect(tok(l, "vendor").text).toHaveLength(WIDTH.vendor);
    expect(tok(l, "value").text).toBe("+12345");
    // an over-long vendor is cut instead of pushing the columns after it
    const long = timingLine(at, "cascade", 0, "stt_final", "some-very-long-vendor", 1);
    expect(tok(long, "vendor").text).toBe("some-very…");
    expect(offsets(long)).toEqual(offsets(lines[0]));
  });

  it("right-aligns numbers in the value column", () => {
    const a = tok(timingLine(at, "cascade", 0, "first_audio", undefined, 5), "value").text;
    const b = tok(timingLine(at, "cascade", 0, "first_audio", undefined, 1234), "value").text;
    expect(a).toBe("    +5");
    expect(b).toBe(" +1234");
  });

  it("marks voice-to-voice speech end as approximate and leaves no delta on speech end", () => {
    const r = timingLine(at, "realtime", 0, "speech_end", undefined, 0);
    expect(tok(r, "note")).toEqual({ kind: "note", text: "≈ VAD silence 500 ms", tone: "muted" });
    expect(tok(r, "value").text.trim()).toBe("");
    const c = timingLine(at, "cascade", 0, "speech_end", undefined, 0);
    expect(tok(c, "note").text).toBe("");
    expect(tok(c, "unit").text.trim()).toBe("");
  });

  it("uses head tokens for the header row", () => {
    const h = headerLine();
    expect(h.filter((t) => t.kind !== "sep").every((t) => t.kind === "head")).toBe(true);
    expect(plain(h)).toMatch(/^time {10}mode {5}turn {2}event {9}vendor {10}Δt {7}note$/);
  });
});

describe("resultLine", () => {
  it("colours the verdict by the 3000 ms first-audio target", () => {
    const ok = resultLine(at, "cascade", 2, "done", { speech_end: 1000, first_audio: 3999, audio_end: 6000 });
    expect(tok(ok, "verdict")).toEqual({ kind: "verdict", text: "✓", tone: "ok" });
    expect(tok(ok, "value")).toEqual({ kind: "value", text: "  2999", tone: "ok" });
    expect(tok(ok, "note").text).toBe("target 3000 ms · end 5000 ms");
    const atTarget = resultLine(at, "cascade", 2, "done", { speech_end: 0, first_audio: 3000 });
    expect(tok(atTarget, "verdict")).toEqual({ kind: "verdict", text: "✗", tone: "bad" });
    expect(tok(atTarget, "value").tone).toBe("bad");
  });

  it("shows failures with their reason in red", () => {
    const f = resultLine(at, "cascade", 2, "failed", {}, "translate timeout");
    expect(tok(f, "verdict")).toEqual({ kind: "verdict", text: "✗", tone: "bad" });
    expect(tok(f, "note")).toEqual({ kind: "note", text: "not interpreted: translate timeout", tone: "bad" });
    expect(tok(resultLine(at, "cascade", 0, "failed", {}), "note").text).toBe("not interpreted: failed");
  });

  it("handles empty, cut and done-without-audio turns", () => {
    const e = resultLine(at, "realtime", 0, "empty", {});
    expect(tok(e, "note")).toEqual({ kind: "note", text: "nothing heard", tone: "muted" });
    const c = resultLine(at, "realtime", 0, "cut", { speech_end: 0, first_audio: 800 });
    expect(tok(c, "verdict").tone).toBe("warn");
    expect(tok(c, "value").text.trim()).toBe("800");
    expect(tok(resultLine(at, "cascade", 0, "done", { speech_end: 1 }), "verdict").tone).toBe("muted");
  });
});

describe("summaryRow", () => {
  const turns = [
    { mode: "cascade" as const, timings: FULL },
    { mode: "cascade" as const, timings: { ...FULL, first_audio: 3000, audio_end: 5000 } },
    { mode: "realtime" as const, timings: { speech_end: 1000, turn_detected: 1500, first_audio: 1800 } },
  ];
  it("gives p50/p95 per mode, a dash for no data and n/a for stages voice-to-voice cannot observe", () => {
    const r = summaryRow(modeSummary(turns, "realtime"));
    expect(r).toMatchObject({ label: "voice-to-voice", turns: "1", firstAudio: ["800", "800"] });
    expect(r.audioEnd).toEqual(["—", "—"]);
    expect(r.stages).toBe("n/a (not observable)");
    const c = summaryRow(modeSummary(turns, "cascade"));
    expect(c.firstAudio).toEqual(["1100", "2000"]);
    expect(c.audioEnd).toEqual(["3000", "4000"]);
    expect(c.stages).toEqual([
      { name: "turn detect", ms: "200" },
      { name: "stt final", ms: "112" },
      { name: "translate", ms: "388" },
      { name: "tts 1st byte", ms: "300" },
      { name: "playback", ms: "100" },
    ]);
    const none = summaryRow(modeSummary([], "cascade"));
    expect(none.turns).toBe("0");
    expect((none.stages as { ms: string }[]).every((s) => s.ms === "—")).toBe(true);
  });
});
