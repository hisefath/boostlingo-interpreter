import { describe, expect, it } from "vitest";
import { summarizeMode } from "../../src/client/timing-and-audio-helpers.ts";
import {
  headerLine,
  toPlainText,
  resultLine,
  summaryRow,
  timingLine,
  COLUMN_WIDTHS,
  type Token,
  type TokenKind,
} from "../../src/client/metrics-terminal.ts";

const wallClockMs = new Date(2026, 9, 18, 23, 41, 2, 120).getTime();
const findToken = (tokens: Token[], kind: TokenKind) => tokens.find((token) => token.kind === kind)!;
const noteColumnOffset = (tokens: Token[]) => toPlainText(tokens.slice(0, -1)).length;

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
    const line = timingLine(wallClockMs, "cascade", 2, "stt_final", "deepgram", 312);
    expect(findToken(line, "time").text.trim()).toBe("23:41:02.120");
    expect(findToken(line, "mode")).toEqual({ kind: "mode", text: "cascade", tone: "cascade" });
    expect(findToken(line, "turn").text).toBe(" t3 ");
    expect(findToken(line, "event").text.trim()).toBe("transcript");
    expect(findToken(line, "vendor").text.trim()).toBe("Deepgram");
    expect(findToken(line, "value").text).toBe("  +312");
    expect(findToken(line, "unit").text).toBe("ms");
    expect(
      timingLine(wallClockMs, "realtime", 0, "first_audio").find((token) => token.kind === "mode")?.tone,
    ).toBe("realtime");
  });

  it("pads every column to its width so lines align with the header", () => {
    const lines = [
      headerLine(),
      timingLine(wallClockMs, "cascade", 2, "first_translation", "openai", 12345),
      timingLine(wallClockMs, "realtime", 11, "speech_end"),
      resultLine(wallClockMs, "cascade", 2, "failed", {}, "translate timeout"),
    ];
    // same token layout everywhere, and every column starts at the same character offset
    const offsets = (line: Token[]) => line.map((_, i) => toPlainText(line.slice(0, i)).length);
    for (const line of lines) expect(offsets(line)).toEqual(offsets(lines[0]));
    expect(new Set(lines.map(noteColumnOffset)).size).toBe(1);
    expect(noteColumnOffset(lines[0])).toBe(
      Object.values(COLUMN_WIDTHS).reduce((a, b) => a + b, 0) + 2 * 6 + 1 * 2, // six 2-space gaps, two 1-space gaps
    );
    const line = lines[1];
    expect(findToken(line, "time").text).toHaveLength(COLUMN_WIDTHS.time);
    expect(findToken(line, "mode").text).toHaveLength(COLUMN_WIDTHS.mode);
    expect(findToken(line, "turn").text).toHaveLength(COLUMN_WIDTHS.turn);
    expect(findToken(line, "event").text).toHaveLength(COLUMN_WIDTHS.event);
    expect(findToken(line, "vendor").text).toHaveLength(COLUMN_WIDTHS.vendor);
    expect(findToken(line, "value").text).toBe("+12345");
    // an over-long vendor is cut instead of pushing the columns after it
    const long = timingLine(wallClockMs, "cascade", 0, "stt_final", "some-very-long-vendor", 1);
    expect(findToken(long, "vendor").text).toBe("some-very…");
    expect(offsets(long)).toEqual(offsets(lines[0]));
  });

  it("right-aligns numbers in the value column", () => {
    const a = findToken(timingLine(wallClockMs, "cascade", 0, "first_audio", undefined, 5), "value").text;
    const b = findToken(timingLine(wallClockMs, "cascade", 0, "first_audio", undefined, 1234), "value").text;
    expect(a).toBe("    +5");
    expect(b).toBe(" +1234");
  });

  it("marks voice-to-voice speech end as approximate and leaves no delta on speech end", () => {
    const voiceToVoice = timingLine(wallClockMs, "realtime", 0, "speech_end", undefined, 0);
    expect(findToken(voiceToVoice, "note")).toEqual({
      kind: "note",
      text: "≈ VAD silence 500 ms",
      tone: "muted",
    });
    expect(findToken(voiceToVoice, "value").text.trim()).toBe("");
    const cascade = timingLine(wallClockMs, "cascade", 0, "speech_end", undefined, 0);
    expect(findToken(cascade, "note").text).toBe("");
    expect(findToken(cascade, "unit").text.trim()).toBe("");
  });

  it("uses header tokens for the header row", () => {
    const header = headerLine();
    expect(
      header.filter((token) => token.kind !== "separator").every((token) => token.kind === "header"),
    ).toBe(true);
    expect(toPlainText(header)).toMatch(/^time {10}mode {5}turn {2}event {9}vendor {10}Δt {7}note$/);
  });
});

describe("resultLine", () => {
  it("colours the verdict by the 3000 ms first-audio target", () => {
    const ok = resultLine(wallClockMs, "cascade", 2, "done", {
      speech_end: 1000,
      first_audio: 3999,
      audio_end: 6000,
    });
    expect(findToken(ok, "verdict")).toEqual({ kind: "verdict", text: "✓", tone: "ok" });
    expect(findToken(ok, "value")).toEqual({ kind: "value", text: "  2999", tone: "ok" });
    expect(findToken(ok, "note").text).toBe("target 3000 ms · end 5000 ms");
    const atTarget = resultLine(wallClockMs, "cascade", 2, "done", { speech_end: 0, first_audio: 3000 });
    expect(findToken(atTarget, "verdict")).toEqual({ kind: "verdict", text: "✗", tone: "bad" });
    expect(findToken(atTarget, "value").tone).toBe("bad");
  });

  it("shows failures with their reason in red", () => {
    const failed = resultLine(wallClockMs, "cascade", 2, "failed", {}, "translate timeout");
    expect(findToken(failed, "verdict")).toEqual({ kind: "verdict", text: "✗", tone: "bad" });
    expect(findToken(failed, "note")).toEqual({
      kind: "note",
      text: "not interpreted: translate timeout",
      tone: "bad",
    });
    expect(findToken(resultLine(wallClockMs, "cascade", 0, "failed", {}), "note").text).toBe(
      "not interpreted: failed",
    );
  });

  it("handles empty, cut and done-without-audio turns", () => {
    const empty = resultLine(wallClockMs, "realtime", 0, "empty", {});
    expect(findToken(empty, "note")).toEqual({ kind: "note", text: "nothing heard", tone: "muted" });
    const cut = resultLine(wallClockMs, "realtime", 0, "cut", { speech_end: 0, first_audio: 800 });
    expect(findToken(cut, "verdict").tone).toBe("warn");
    expect(findToken(cut, "value").text.trim()).toBe("800");
    expect(findToken(resultLine(wallClockMs, "cascade", 0, "done", { speech_end: 1 }), "verdict").tone).toBe(
      "muted",
    );
  });
});

describe("summaryRow", () => {
  const turns = [
    { mode: "cascade" as const, timings: FULL },
    { mode: "cascade" as const, timings: { ...FULL, first_audio: 3000, audio_end: 5000 } },
    { mode: "realtime" as const, timings: { speech_end: 1000, turn_detected: 1500, first_audio: 1800 } },
  ];
  it("gives p50/p95 per mode, a dash for no data and n/a for stages voice-to-voice cannot observe", () => {
    const voiceToVoice = summaryRow(summarizeMode(turns, "realtime"));
    expect(voiceToVoice).toMatchObject({ label: "voice-to-voice", turns: "1", firstAudio: ["800", "800"] });
    expect(voiceToVoice.audioEnd).toEqual(["—", "—"]);
    expect(voiceToVoice.stages).toBe("n/a (not observable)");
    const cascade = summaryRow(summarizeMode(turns, "cascade"));
    expect(cascade.firstAudio).toEqual(["1100", "2000"]);
    expect(cascade.audioEnd).toEqual(["3000", "4000"]);
    expect(cascade.stages).toEqual([
      { name: "turn detect", ms: "200" },
      { name: "stt final", ms: "112" },
      { name: "translate", ms: "388" },
      { name: "tts 1st byte", ms: "300" },
      { name: "playback", ms: "100" },
    ]);
    const none = summaryRow(summarizeMode([], "cascade"));
    expect(none.turns).toBe("0");
    expect((none.stages as { ms: string }[]).every((stage) => stage.ms === "—")).toBe(true);
  });
});
