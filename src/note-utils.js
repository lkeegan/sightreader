export const STAFF_BASE_NOTE = { letterIndex: 2, octave: 4 }; // E4 on the bottom line.
export const LETTERS = ["C", "D", "E", "F", "G", "A", "H"];
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];

export function parseNoteName(name) {
  const match = /^([A-GHB])([#b]?)(-?\d+)$/.exec(name);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octave] = match;
  return { letter, accidental, octave: Number(octave) };
}

export function formatNoteLabel(note) {
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

export function staffIndexToNoteName(index) {
  let letterIndex = STAFF_BASE_NOTE.letterIndex;
  let octave = STAFF_BASE_NOTE.octave;
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

export function noteNameToStaffIndex(name) {
  const parsed = parseNoteName(name);
  if (!parsed) return null;
  const normalizedLetter = parsed.letter === "B" ? "H" : parsed.letter;
  const letterIndex = LETTERS.indexOf(normalizedLetter);
  if (letterIndex === -1) return null;
  const baseDiatonic = STAFF_BASE_NOTE.octave * 7 + STAFF_BASE_NOTE.letterIndex;
  const targetDiatonic = parsed.octave * 7 + letterIndex;
  return targetDiatonic - baseDiatonic;
}

export function frequencyToNote(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const noteName = `${name}${octave}`;
  const baseName = `${name.replace("#", "").replace("b", "")}${octave}`;
  return {
    name: noteName,
    baseName,
    midi,
    accidental: name.includes("#") ? "#" : name.includes("b") ? "b" : "",
    letter: name.replace("#", "").replace("b", ""),
    octave,
  };
}

function bitReverse(value, bits) {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

export function dominantFrequencyFromSamples(samples, sampleRate, minHz = 80, maxHz = 1000) {
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

export function detectNoteFromSamples(samples, sampleRate, minHz = 80, maxHz = 1000) {
  const frequency = dominantFrequencyFromSamples(samples, sampleRate, minHz, maxHz);
  if (!frequency) return null;
  return frequencyToNote(frequency);
}

export function generateSineSamples(frequency, sampleRate, length) {
  const samples = new Float64Array(length);
  const step = (Math.PI * 2 * frequency) / sampleRate;
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin(step * i);
  }
  return samples;
}

export function generateHarmonicSamples(frequency, sampleRate, length, harmonics = [1, 0.5, 0.25]) {
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
