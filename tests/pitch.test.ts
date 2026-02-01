import { describe, expect, it } from "vitest";
import {
  detectNoteFromSamples,
  generateHarmonicSamples,
  generateSineSamples,
  noteNameToStaffIndex,
  staffIndexToNoteName,
} from "../src/note-utils";

const sampleRate = 44100;
const length = 4096;

function expectDetected(frequency: number, expectedName: string) {
  const samples = generateHarmonicSamples(frequency, sampleRate, length);
  const detected = detectNoteFromSamples(samples, sampleRate);
  expect(detected?.name).toBe(expectedName);
}

describe("pitch detection", () => {
  it("detects A4 (440 Hz)", () => {
    expectDetected(440, "A4");
  });

  it("detects C4 (261.63 Hz)", () => {
    expectDetected(261.63, "C4");
  });

  it("detects G3 (196 Hz)", () => {
    expectDetected(196, "G3");
  });

  it("detects H4 (493.88 Hz)", () => {
    expectDetected(493.88, "H4");
  });

  it("detects D4 with a pure sine wave", () => {
    const samples = generateSineSamples(293.66, sampleRate, length);
    const detected = detectNoteFromSamples(samples, sampleRate);
    expect(detected?.name).toBe("D4");
  });

  it("detects E4 with a pure sine wave", () => {
    const samples = generateSineSamples(329.63, sampleRate, length);
    const detected = detectNoteFromSamples(samples, sampleRate);
    expect(detected?.name).toBe("E4");
  });

  it("detects F4 with a pure sine wave", () => {
    const samples = generateSineSamples(349.23, sampleRate, length);
    const detected = detectNoteFromSamples(samples, sampleRate);
    expect(detected?.name).toBe("F4");
  });

  it("detects G4 with a pure sine wave", () => {
    const samples = generateSineSamples(392.0, sampleRate, length);
    const detected = detectNoteFromSamples(samples, sampleRate);
    expect(detected?.name).toBe("G4");
  });

  it("detects A3 with a pure sine wave", () => {
    const samples = generateSineSamples(220.0, sampleRate, length);
    const detected = detectNoteFromSamples(samples, sampleRate);
    expect(detected?.name).toBe("A3");
  });
});

describe("staff index mapping", () => {
  it("maps staff indices round-trip", () => {
    const indices = [-6, -2, -1, 0, 2, 4, 7, 10, 12];
    for (const index of indices) {
      const name = staffIndexToNoteName(index);
      expect(noteNameToStaffIndex(name)).toBe(index);
    }
  });
});
