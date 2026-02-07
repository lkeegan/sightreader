export type ClefName = "treble" | "bass";
export type KeySignatureKey =
  | "natural"
  | "sharp"
  | "sharp2"
  | "sharp3"
  | "sharp4"
  | "sharp5"
  | "flat"
  | "flat2"
  | "flat3"
  | "flat4"
  | "flat5";
export type Accidental = "#" | "b" | "##" | "bb" | "natural";

export interface BaseNote {
  letterIndex: number;
  octave: number;
}

export interface Note {
  name: string;
  staffIndex?: number | null;
  accidental?: Accidental | null;
  baseName?: string;
  midi?: number | null;
  letter?: string;
  octave?: number;
}

export const STAFF_BASE_NOTE: BaseNote = { letterIndex: 2, octave: 4 }; // Treble: E4 on the bottom line.
export const LETTERS = ["C", "D", "E", "F", "G", "A", "H"] as const;
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"] as const;
export const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "H"] as const;
export const FLAT_ORDER = ["H", "E", "A", "D", "G", "C", "F"] as const;
export const KEY_SIGNATURES: Record<KeySignatureKey, { type: "natural" | "sharp" | "flat"; count: number }> = {
  natural: { type: "natural", count: 0 },
  sharp: { type: "sharp", count: 1 },
  sharp2: { type: "sharp", count: 2 },
  sharp3: { type: "sharp", count: 3 },
  sharp4: { type: "sharp", count: 4 },
  sharp5: { type: "sharp", count: 5 },
  flat: { type: "flat", count: 1 },
  flat2: { type: "flat", count: 2 },
  flat3: { type: "flat", count: 3 },
  flat4: { type: "flat", count: 4 },
  flat5: { type: "flat", count: 5 },
};

export const DEFAULT_SESSION_NOTES = 10;

export function parseNoteName(name: string) {
  const match = /^([A-GHB])([#b]{0,2})(-?\d+)$/.exec(name);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octave] = match;
  return { letter, accidental, octave: Number(octave) };
}

export function formatNoteLabel(note: Note) {
  const parsed = parseNoteName(note.name);
  if (!parsed) return note.name;
  const { letter, accidental, octave } = parsed;
  if (letter === "B" && accidental === "b") {
    return `B${octave}`;
  }
  if (letter === "B" && accidental !== "b") {
    return `H${octave}`;
  }
  return `${letter}${accidental}${octave}`;
}

export function staffIndexToNoteName(index: number, baseNote: BaseNote = STAFF_BASE_NOTE) {
  let letterIndex = baseNote.letterIndex;
  let octave = baseNote.octave;
  if (index > 0) {
    for (let step = 0; step < index; step += 1) {
      letterIndex += 1;
      if (letterIndex >= LETTERS.length) {
        letterIndex = 0;
        octave += 1;
      }
    }
  } else if (index < 0) {
    for (let step = 0; step < Math.abs(index); step += 1) {
      letterIndex -= 1;
      if (letterIndex < 0) {
        letterIndex = LETTERS.length - 1;
        octave -= 1;
      }
    }
  }
  return `${LETTERS[letterIndex]}${octave}`;
}

export function noteNameToStaffIndex(name: string, baseNote: BaseNote = STAFF_BASE_NOTE) {
  const parsed = parseNoteName(name);
  if (!parsed) return null;
  const normalizedLetter = parsed.letter === "B" ? "H" : parsed.letter;
  const letterIndex = LETTERS.indexOf(normalizedLetter as (typeof LETTERS)[number]);
  if (letterIndex === -1) return null;
  const baseDiatonic = baseNote.octave * 7 + baseNote.letterIndex;
  const targetDiatonic = parsed.octave * 7 + letterIndex;
  return targetDiatonic - baseDiatonic;
}

function requireStaffIndex(name: string, baseNote: BaseNote = STAFF_BASE_NOTE) {
  const index = noteNameToStaffIndex(name, baseNote);
  if (index === null) {
    throw new Error(`Invalid staff index for ${name}`);
  }
  return index;
}

export function getBaseRangeForClef(clefName: ClefName, baseNote: BaseNote) {
  if (clefName === "treble") {
    return {
      minIndex: requireStaffIndex("C4", baseNote),
      maxIndex: requireStaffIndex("A5", baseNote),
    };
  }
  return {
    minIndex: requireStaffIndex("E3", baseNote),
    maxIndex: requireStaffIndex("C4", baseNote),
  };
}

export function getRangeForLevel(clefName: ClefName, baseNote: BaseNote, level: number) {
  const base = getBaseRangeForClef(clefName, baseNote);
  const octaveSteps = 7;
  if (level >= 3) {
    return {
      minIndex: base.minIndex - octaveSteps,
      maxIndex: base.maxIndex + octaveSteps,
    };
  }
  return base;
}

export function buildNotePoolForLevel(clefName: ClefName, baseNote: BaseNote, level: number): Note[] {
  const pool: Note[] = [];
  const { minIndex, maxIndex } = getRangeForLevel(clefName, baseNote, level);
  for (let index = minIndex; index <= maxIndex; index += 1) {
    const baseName = staffIndexToNoteName(index, baseNote);
    pool.push({ name: baseName, staffIndex: index });
    if (level < 2) continue;
    const match = /^([A-GH])(\d+)$/.exec(baseName);
    if (!match) continue;
    const [, letter, octave] = match;
    pool.push({ name: `${letter}#${octave}`, staffIndex: index, accidental: "#" });
    const flatLetter = letter === "H" ? "B" : letter;
    pool.push({ name: `${flatLetter}b${octave}`, staffIndex: index, accidental: "b" });
    if (level < 4) continue;
    pool.push({ name: `${letter}##${octave}`, staffIndex: index, accidental: "##" });
    pool.push({ name: `${flatLetter}bb${octave}`, staffIndex: index, accidental: "bb" });
  }
  return pool;
}

export function shouldEndSession(completed: number, total: number = DEFAULT_SESSION_NOTES) {
  return completed >= total;
}

export function applyKeySignatureToLetter(letter: string, signatureKey: KeySignatureKey) {
  const signatureAcc = signatureAccidentalForLetter(letter, signatureKey);
  if (!signatureAcc) return letter;
  return `${letter}${signatureAcc}`;
}

export function frequencyToNote(frequency: number): Note {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const noteName = `${name}${octave}`;
  const baseName = `${name.replace("#", "").replace("b", "")}${octave}`;
  return {
    name: noteName,
    baseName,
    midi,
    accidental: name.includes("#") ? "#" : name.includes("b") ? "b" : null,
    letter: name.replace("#", "").replace("b", ""),
    octave,
  };
}

export function noteNameToMidi(name: string) {
  const match = /^([A-GHB])([#b]{0,2})(-?\d+)$/.exec(name);
  if (!match) return null;
  const [, letter, accidental, octaveRaw] = match;
  const octave = Number(octaveRaw);
  const baseSemitone = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    H: 11,
    B: 11,
  }[letter];
  if (baseSemitone === undefined) return null;
  let semitone = baseSemitone;
  if (accidental === "#") semitone += 1;
  if (accidental === "b") semitone -= 1;
  if (accidental === "##") semitone += 2;
  if (accidental === "bb") semitone -= 2;
  return (octave + 1) * 12 + semitone;
}

export function signatureAccidentalForLetter(letter: string, signatureKey: KeySignatureKey) {
  const signature = KEY_SIGNATURES[signatureKey];
  if (!signature || signature.count === 0) return null;
  const order = signature.type === "sharp" ? SHARP_ORDER : FLAT_ORDER;
  const affected = new Set<string>(order.slice(0, signature.count));
  if (!affected.has(letter)) return null;
  return signature.type === "sharp" ? "#" : "b";
}

export function effectiveNoteName(note: Note, signatureKey: KeySignatureKey) {
  if (!note?.name) return null;
  const match = /^([A-GHB])([#b]{0,2})(-?\d+)$/.exec(note.name);
  if (!match) return note.name;
  const [, letter, accidental, octave] = match;
  if (note.accidental === "natural") {
    return `${letter}${octave}`;
  }
  if (accidental) {
    return note.name;
  }
  const signature = KEY_SIGNATURES[signatureKey];
  if (!signature || signature.count === 0) return note.name;
  const order = signature.type === "sharp" ? SHARP_ORDER : FLAT_ORDER;
  const affected = new Set<string>(order.slice(0, signature.count));
  if (!affected.has(letter)) return note.name;
  const applied = signature.type === "sharp" ? "#" : "b";
  return `${letter}${applied}${octave}`;
}

export function notesMatchByMidi(detected: Note | null, target: Note | null, signatureKey: KeySignatureKey) {
  if (!detected || !target) return false;
  const targetName = effectiveNoteName(target, signatureKey);
  const targetMidi = targetName ? noteNameToMidi(targetName) : null;
  const detectedMidi = Number.isFinite(detected?.midi)
    ? detected.midi
    : detected?.name
      ? noteNameToMidi(detected.name)
      : null;
  if (targetMidi === null || detectedMidi === null) return false;
  return targetMidi === detectedMidi;
}

export function adjustNoteForKeyChange(
  note: Note,
  previousSignature: KeySignatureKey,
  nextSignature: KeySignatureKey,
  baseNote: BaseNote = STAFF_BASE_NOTE,
): Note {
  if (!note) return note;
  const staffIndex =
    typeof note.staffIndex === "number" ? note.staffIndex : noteNameToStaffIndex(note.name, baseNote);
  if (typeof staffIndex !== "number") return note;
  const previousName = effectiveNoteName(note, previousSignature);
  if (!previousName) return note;
  const previousMidi = noteNameToMidi(previousName);
  if (previousMidi === null) return note;
  const baseName = staffIndexToNoteName(staffIndex, baseNote);
  const match = /^([A-GH])(\d+)$/.exec(baseName);
  if (!match) return note;
  const [, letter, octave] = match;
  const flatLetter = letter === "H" ? "B" : letter;
  const candidates: { acc: Accidental | null; name: string; midi: number | null }[] = [
    { acc: null, name: baseName, midi: noteNameToMidi(baseName) },
    { acc: "#", name: `${letter}#${octave}`, midi: noteNameToMidi(`${letter}#${octave}`) },
    { acc: "b", name: `${flatLetter}b${octave}`, midi: noteNameToMidi(`${flatLetter}b${octave}`) },
  ];
  const chosen = candidates.find((candidate) => candidate.midi === previousMidi) || candidates[0];
  const signatureAcc = signatureAccidentalForLetter(letter, nextSignature);

  let name = baseName;
  let accidental: Accidental | null = null;
  if (chosen.acc === null) {
    accidental = signatureAcc ? "natural" : null;
  } else if (chosen.acc === signatureAcc) {
    accidental = null;
  } else {
    name = chosen.name;
    accidental = chosen.acc;
  }

  return { ...note, name, staffIndex, accidental };
}

function bitReverse(value: number, bits: number) {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

export function dominantFrequencyFromSamples(
  samples: Float64Array,
  sampleRate: number,
  minHz: number = 80,
  maxHz: number = 1000,
) {
  const n = samples.length;
  const bits = Math.log2(n);
  if (!Number.isInteger(bits)) {
    throw new Error("Sample length must be a power of two.");
  }

  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    real[i] = samples[i];
  }

  for (let i = 0; i < n; i += 1) {
    const j = bitReverse(i, bits);
    if (j > i) {
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;
      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const tableStep = (Math.PI * 2) / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j += 1) {
        const k = i + j;
        const l = k + half;
        const angle = -tableStep * j;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const treal = real[l] * cos - imag[l] * sin;
        const timag = real[l] * sin + imag[l] * cos;
        real[l] = real[k] - treal;
        imag[l] = imag[k] - timag;
        real[k] += treal;
        imag[k] += timag;
      }
    }
  }

  let maxIndex = -1;
  let maxValue = -Infinity;
  const maxBin = Math.floor((maxHz / sampleRate) * n);
  const minBin = Math.max(1, Math.floor((minHz / sampleRate) * n));

  for (let i = minBin; i <= maxBin; i += 1) {
    const magnitude = Math.hypot(real[i], imag[i]);
    if (magnitude > maxValue) {
      maxValue = magnitude;
      maxIndex = i;
    }
  }

  if (maxIndex === -1) {
    return null;
  }

  return (maxIndex / n) * sampleRate;
}

export function detectNoteFromSamples(
  samples: Float64Array,
  sampleRate: number,
  minHz: number = 80,
  maxHz: number = 1000,
) {
  const frequency = dominantFrequencyFromSamples(samples, sampleRate, minHz, maxHz);
  if (!frequency) return null;
  return frequencyToNote(frequency);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function generateSineSamples(frequency: number, sampleRate: number, length: number) {
  const samples = new Float64Array(length);
  const step = (Math.PI * 2 * frequency) / sampleRate;
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin(step * i);
  }
  return samples;
}

export function generateHarmonicSamples(
  frequency: number,
  sampleRate: number,
  length: number,
  harmonics: number[] = [1, 0.5, 0.25],
) {
  const samples = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    let value = 0;
    for (let h = 0; h < harmonics.length; h += 1) {
      const harmonicIndex = h + 1;
      value += harmonics[h] * Math.sin((Math.PI * 2 * frequency * harmonicIndex * i) / sampleRate);
    }
    samples[i] = value;
  }
  return samples;
}
