import { describe, expect, it } from "vitest";
import {
  clockOffset,
  encodeWav,
  floatToPcm16,
  guessLang,
  parseAudioFrame,
  pcm16ToFloat,
  resample,
  summarizeTimings,
} from "../../src/client/lib.ts";

describe("guessLang", () => {
  it("detects Spanish by accents and stopwords", () => {
    expect(guessLang("¿Dónde le duele?")).toBe("es");
    expect(guessLang("tengo dolor en el pecho")).toBe("es");
  });
  it("detects English", () => {
    expect(guessLang("Where does it hurt?")).toBe("en");
    expect(guessLang("I have chest pain")).toBe("en");
  });
  it("falls back for empty text", () => {
    expect(guessLang("", "es")).toBe("es");
    expect(guessLang("   ")).toBe("en");
  });
});

describe("clockOffset", () => {
  it("maps server time to browser time assuming a symmetric round trip", () => {
    // sent at 100, server stamped 5050, received at 120 -> server was at 5050 when browser was at 110
    const off = clockOffset(100, 5050, 120);
    expect(off).toBe(4940);
    expect(5050 - off).toBe(110);
  });
});

describe("summarizeTimings", () => {
  it("computes totals and cascade stage bars from speech end", () => {
    const s = summarizeTimings(
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
    expect(s.toFirstAudio).toBe(900);
    expect(s.toEnd).toBe(2900);
    expect(s.stages.map((x) => x.ms)).toEqual([200, 100, 200, 300, 100]);
  });
  it("marks stages not observable in voice-to-voice mode", () => {
    const s = summarizeTimings({ speech_end: 1000, turn_detected: 1100, first_audio: 1700 }, "realtime");
    expect(s.toFirstAudio).toBe(700);
    expect(s.toEnd).toBeNull();
    expect(s.stages.every((x) => x.ms === null && !x.observable)).toBe(true);
  });
  it("returns null for missing or out-of-order points", () => {
    const s = summarizeTimings({ first_audio: 1900 }, "cascade");
    expect(s.toFirstAudio).toBeNull();
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
    const f = pcm16ToFloat(new Int16Array([0, 16384, -32768]));
    expect(Array.from(f)).toEqual([0, 0.5, -1]);
  });
  it("resamples 48 kHz to 16 kHz with exact length and preserved shape", () => {
    const input = new Float32Array(960).map((_, i) => i / 960);
    const out = resample(input, 48000, 16000);
    expect(out.length).toBe(320);
    expect(out[0]).toBe(0);
    expect(out[100]).toBeCloseTo(300 / 960, 5);
  });
  it("resamples 44.1 kHz 20 ms blocks to 320 samples and passes equal rates through", () => {
    expect(resample(new Float32Array(882), 44100, 16000).length).toBe(320);
    const same = new Float32Array([1, 2, 3]);
    expect(resample(same, 16000, 16000)).toBe(same);
  });
});

describe("parseAudioFrame", () => {
  it("reads a big-endian 4-byte seq then PCM16 little-endian samples", () => {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(0, 258, false);
    dv.setInt16(4, 1000, true);
    dv.setInt16(6, -2, true);
    const { seq, pcm } = parseAudioFrame(buf);
    expect(seq).toBe(258);
    expect(Array.from(pcm)).toEqual([1000, -2]);
  });
});

describe("encodeWav", () => {
  it("writes a 44-byte RIFF header and PCM16 data", () => {
    const wav = encodeWav(new Int16Array([1, -1]), 24000);
    const dv = new DataView(wav.buffer);
    expect(wav.length).toBe(48);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(dv.getUint32(24, true)).toBe(24000);
    expect(dv.getUint32(40, true)).toBe(4);
    expect(dv.getInt16(44, true)).toBe(1);
    expect(dv.getInt16(46, true)).toBe(-1);
  });
});
