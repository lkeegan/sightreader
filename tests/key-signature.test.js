import { describe, expect, it } from "vitest";
import {
  adjustNoteForKeyChange,
  effectiveNoteName,
  shouldEndSession,
  noteNameToMidi,
  noteNameToStaffIndex,
  STAFF_BASE_NOTE,
} from "../src/note-utils.js";

describe("key signature adjustments", () => {
  it("adds a natural sign when the new key signature would sharpen the note", () => {
    const staffIndex = noteNameToStaffIndex("F4", STAFF_BASE_NOTE);
    const result = adjustNoteForKeyChange(
      { name: "F4", staffIndex },
      "natural",
      "sharp",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBe("natural");
    const effective = effectiveNoteName(result, "sharp");
    expect(noteNameToMidi(effective)).toBe(noteNameToMidi("F4"));
  });

  it("adds a natural sign when switching to a key with G# in it", () => {
    const staffIndex = noteNameToStaffIndex("G4", STAFF_BASE_NOTE);
    const result = adjustNoteForKeyChange(
      { name: "G4", staffIndex },
      "natural",
      "sharp3",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBe("natural");
    const effective = effectiveNoteName(result, "sharp3");
    expect(noteNameToMidi(effective)).toBe(noteNameToMidi("G4"));
  });

  it("removes an explicit sharp when the key signature supplies it", () => {
    const staffIndex = noteNameToStaffIndex("F4", STAFF_BASE_NOTE);
    const result = adjustNoteForKeyChange(
      { name: "F#4", staffIndex, accidental: "#" },
      "natural",
      "sharp",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("F4");
    const effective = effectiveNoteName(result, "sharp");
    expect(noteNameToMidi(effective)).toBe(noteNameToMidi("F#4"));
  });

  it("removes an explicit flat when the key signature supplies it", () => {
    const staffIndex = noteNameToStaffIndex("H4", STAFF_BASE_NOTE);
    const result = adjustNoteForKeyChange(
      { name: "Bb4", staffIndex, accidental: "b" },
      "natural",
      "flat",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("H4");
    const effective = effectiveNoteName(result, "flat");
    expect(noteNameToMidi(effective)).toBe(noteNameToMidi("Bb4"));
  });

  it("drops a natural sign when switching back to no key signature", () => {
    const staffIndex = noteNameToStaffIndex("G4", STAFF_BASE_NOTE);
    const result = adjustNoteForKeyChange(
      { name: "G4", staffIndex, accidental: "natural" },
      "sharp3",
      "natural",
      STAFF_BASE_NOTE,
    );
    expect(result.accidental).toBeNull();
    expect(result.name).toBe("G4");
    const effective = effectiveNoteName(result, "natural");
    expect(noteNameToMidi(effective)).toBe(noteNameToMidi("G4"));
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
