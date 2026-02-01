import { describe, expect, it } from "vitest";
import {
  buildNotePoolForLevel,
  getRangeForLevel,
  noteNameToStaffIndex,
  staffIndexToNoteName,
  STAFF_BASE_NOTE,
} from "../src/note-utils.js";

const trebleBase = { letterIndex: 2, octave: 4 };
const bassBase = { letterIndex: 4, octave: 2 };

describe("level note pools", () => {
  it("treble level 1 is C4 to A5, naturals only", () => {
    const pool = buildNotePoolForLevel("treble", trebleBase, 1);
    const names = new Set(pool.map((note) => note.name));
    expect(names.has("C4")).toBe(true);
    expect(names.has("A5")).toBe(true);
    expect(names.has("B3")).toBe(false);
    expect(names.has("C6")).toBe(false);
    expect(names.has("C#4")).toBe(false);
    expect(names.has("Db4")).toBe(false);
  });

  it("treble level 2 adds accidentals but keeps the same range", () => {
    const pool = buildNotePoolForLevel("treble", trebleBase, 2);
    const names = new Set(pool.map((note) => note.name));
    expect(names.has("C4")).toBe(true);
    expect(names.has("A5")).toBe(true);
    expect(names.has("C#4")).toBe(true);
    expect(names.has("Db4")).toBe(true);
    expect(names.has("C6")).toBe(false);
  });

  it("treble level 3 expands one octave and includes accidentals", () => {
    const range = getRangeForLevel("treble", trebleBase, 3);
    const pool = buildNotePoolForLevel("treble", trebleBase, 3);
    const names = new Set(pool.map((note) => note.name));
    const minName = staffIndexToNoteName(range.minIndex, trebleBase);
    const maxName = staffIndexToNoteName(range.maxIndex, trebleBase);
    expect(names.has(minName)).toBe(true);
    expect(names.has(maxName)).toBe(true);
    expect(names.has("C#4")).toBe(true);
  });

  it("bass level 1 is E3 to C4, naturals only", () => {
    const pool = buildNotePoolForLevel("bass", bassBase, 1);
    const names = new Set(pool.map((note) => note.name));
    expect(names.has("E3")).toBe(true);
    expect(names.has("C4")).toBe(true);
    expect(names.has("D3")).toBe(false);
    expect(names.has("C#4")).toBe(false);
  });
});
