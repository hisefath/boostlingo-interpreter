import { describe, expect, it } from "vitest";
import {
  clockOffsetMs,
  encodeWav,
  floatToPcm16,
  guessLanguageWithDefaults,
  parseAudioFrame,
  pcm16ToFloat,
  resampleFloat32,
  summarizeTimings,
} from "../../src/client/timing-and-audio-helpers.ts";

describe("guessLanguageWithDefaults", () => {
  it("detects Spanish by accents and stopwords", () => {
    expect(guessLanguageWithDefaults("¿Dónde le duele?")).toBe("es");
    expect(guessLanguageWithDefaults("tengo dolor en el pecho")).toBe("es");
  });
  it("detects English", () => {
    expect(guessLanguageWithDefaults("Where does it hurt?")).toBe("en");
    expect(guessLanguageWithDefaults("I have chest pain")).toBe("en");
  });
  it("falls back for empty text", () => {
    expect(guessLanguageWithDefaults("", "es")).toBe("es");
    expect(guessLanguageWithDefaults("   ")).toBe("en");
  });
});

describe("clockOffsetMs", () => {
  it("maps server time to browser time assuming a symmetric round trip", () => {
    // sent at 100, server stamped 5050, received at 120 -> server was at 5050 when browser was at 110
    const offset = clockOffsetMs(100, 5050, 120);
    expect(offset).toBe(4940);
    expect(5050 - offset).toBe(110);
  });
});

describe("summarizeTimings", () => {
  it("computes totals and cascade stage bars from speech end", () => {
    const summary = summarizeTimings(
      {
        speech_end: 1000,
        turn_detected: 1200,
        stt_final: 1300,
        first_translation: 1500,
        first_tts_byte: 1800,
        first_audio: 1900,
        audio_end: 3900,
      },
      "cascade",
    );
    expect(summary.toFirstAudio).toBe(900);
    expect(summary.toAudioEnd).toBe(2900);
    expect(summary.stages.map((stage) => stage.ms)).toEqual([200, 100, 200, 300, 100]);
  });
  it("marks stages not observable in voice-to-voice mode", () => {
    const summary = summarizeTimings(
      { speech_end: 1000, turn_detected: 1100, first_audio: 1700 },
      "realtime",
    );
    expect(summary.toFirstAudio).toBe(700);
    expect(summary.toAudioEnd).toBeNull();
    expect(summary.stages.every((stage) => stage.ms === null && !stage.observable)).toBe(true);
  });
  it("returns null for missing or out-of-order points", () => {
    const summary = summarizeTimings({ first_audio: 1900 }, "cascade");
    expect(summary.toFirstAudio).toBeNull();
    expect(summarizeTimings({ speech_end: 2000, first_audio: 1900 }, "cascade").toFirstAudio).toBeNull();
  });
});

describe("PCM conversion", () => {
  it("clamps and scales float to PCM16", () => {
    expect(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([
      0, 32767, -32768, 32767, -32768, 16384,
    ]);
  });
  it("round-trips PCM16 to float", () => {
    const samples = pcm16ToFloat(new Int16Array([0, 16384, -32768]));
    expect(Array.from(samples)).toEqual([0, 0.5, -1]);
  });
  it("resamples 48 kHz to 16 kHz with exact length and preserved shape", () => {
    const input = new Float32Array(960).map((_, i) => i / 960);
    const out = resampleFloat32(input, 48000, 16000);
    expect(out.length).toBe(320);
    expect(out[0]).toBe(0);
    expect(out[100]).toBeCloseTo(300 / 960, 5);
  });
  it("resamples 44.1 kHz 20 ms blocks to 320 samples and passes equal rates through", () => {
    expect(resampleFloat32(new Float32Array(882), 44100, 16000).length).toBe(320);
    const same = new Float32Array([1, 2, 3]);
    expect(resampleFloat32(same, 16000, 16000)).toBe(same);
  });
});

describe("parseAudioFrame", () => {
  it("reads a big-endian 4-byte seq then PCM16 little-endian samples", () => {
    const frame = new ArrayBuffer(8);
    const view = new DataView(frame);
    view.setUint32(0, 258, false);
    view.setInt16(4, 1000, true);
    view.setInt16(6, -2, true);
    const { seq, pcm } = parseAudioFrame(frame);
    expect(seq).toBe(258);
    expect(Array.from(pcm)).toEqual([1000, -2]);
  });
});

describe("encodeWav", () => {
  it("writes a 44-byte RIFF header and PCM16 data", () => {
    const wav = encodeWav(new Int16Array([1, -1]), 24000);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(48);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(1);
    expect(view.getInt16(46, true)).toBe(-1);
  });
});
