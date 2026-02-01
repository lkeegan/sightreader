import { describe, expect, it } from "vitest";
import {
  adjustNoteForKeyChange,
  effectiveNoteName,
  shouldEndSession,
  noteNameToMidi,
  noteNameToStaffIndex,
  applyKeySignatureToLetter,
  STAFF_BASE_NOTE,
  notesMatchByMidi,
} from "../src/note-utils";

describe("key signature adjustments", () => {
  it("adds a natural sign when the new key signature would sharpen the note", () => {
    const staffIndex = noteNameToStaffIndex("F4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "F4", staffIndex },
      "natural",
      "sharp",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBe("natural");
    const effective = effectiveNoteName(result, "sharp");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("F4"));
  });

  it("adds a natural sign when switching to a key with G# in it", () => {
    const staffIndex = noteNameToStaffIndex("G4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "G4", staffIndex },
      "natural",
      "sharp3",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBe("natural");
    const effective = effectiveNoteName(result, "sharp3");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("G4"));
  });

  it("removes an explicit sharp when the key signature supplies it", () => {
    const staffIndex = noteNameToStaffIndex("F4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "F#4", staffIndex, accidental: "#" },
      "natural",
      "sharp",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("F4");
    const effective = effectiveNoteName(result, "sharp");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("F#4"));
  });

  it("removes an explicit flat when the key signature supplies it", () => {
    const staffIndex = noteNameToStaffIndex("H4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "Bb4", staffIndex, accidental: "b" },
      "natural",
      "flat",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("H4");
    const effective = effectiveNoteName(result, "flat");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("Bb4"));
  });

  it("drops a natural sign when switching back to no key signature", () => {
    const staffIndex = noteNameToStaffIndex("G4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "G4", staffIndex, accidental: "natural" },
      "sharp3",
      "natural",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("G4");
    const effective = effectiveNoteName(result, "natural");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("G4"));
  });

  it("keeps the same pitch when moving from a sharp key to natural", () => {
    const staffIndex = noteNameToStaffIndex("F4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "F4", staffIndex },
      "sharp",
      "natural",
      STAFF_BASE_NOTE,
    );
    const effective = effectiveNoteName(result, "natural");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("F#4"));
    expect(result.accidental).toBe("#");
  });

  it("keeps the same pitch when moving into a flat key", () => {
    const staffIndex = noteNameToStaffIndex("H4", STAFF_BASE_NOTE) ?? 0;
    const result = adjustNoteForKeyChange(
      { name: "H4", staffIndex },
      "natural",
      "flat",
      STAFF_BASE_NOTE,
    );
    const effective = effectiveNoteName(result, "flat");
    expect(effective).not.toBeNull();
    expect(noteNameToMidi(effective!)).toBe(noteNameToMidi("H4"));
    expect(result.accidental).toBe("natural");
  });

  it("applies key signature accidentals when no explicit accidental is set", () => {
    expect(effectiveNoteName({ name: "F4" }, "sharp")).toBe("F#4");
    expect(effectiveNoteName({ name: "H4" }, "flat")).toBe("Hb4");
  });

  it("reports the altered letter when key signatures apply", () => {
    expect(applyKeySignatureToLetter("F", "sharp")).toBe("F#");
    expect(applyKeySignatureToLetter("H", "flat")).toBe("Hb");
    expect(applyKeySignatureToLetter("C", "flat")).toBe("C");
  });

  it("matches enharmonic equivalents by MIDI", () => {
    const target = { name: "Db4" };
    const detected = { name: "C#4" };
    expect(notesMatchByMidi(detected, target, "natural")).toBe(true);
  });

  it("treats enharmonic equivalents as the same pitch", () => {
    expect(noteNameToMidi("Db4")).toBe(noteNameToMidi("C#4"));
    expect(noteNameToMidi("Eb4")).toBe(noteNameToMidi("D#4"));
    expect(noteNameToMidi("Gb3")).toBe(noteNameToMidi("F#3"));
  });

  it("ends a session after the configured number of notes", () => {
    expect(shouldEndSession(9, 10)).toBe(false);
    expect(shouldEndSession(10, 10)).toBe(true);
  });
});
