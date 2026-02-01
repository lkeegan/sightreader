export interface StaffLayout {
  left: number;
  top: number;
  width: number;
  lineGap: number;
}

export interface ClefDefinition {
  name: string;
  symbol: string;
  baseNote: { letterIndex: number; octave: number };
  symbolIndex: number;
  symbolOffset: number;
}

export interface AudioConfig {
  fftSize: number;
  smoothing: number;
  minHoldMs: number;
  minPitchHz: number;
  maxPitchHz: number;
  octaveTolerance: number;
  clarityThreshold: number;
  rmsThreshold: number;
}

export const STAFF_DEFAULT: StaffLayout = {
  left: 110,
  top: 130,
  width: 680,
  lineGap: 18,
};

export const CLEF_STYLE: { lineExtension: number } = {
  lineExtension: 40,
};

export const CLEFS: { treble: ClefDefinition; bass: ClefDefinition } = {
  treble: {
    name: "Treble",
    symbol: "𝄞",
    baseNote: { letterIndex: 2, octave: 4 }, // E4 on the bottom line.
    symbolIndex: 2,
    symbolOffset: 0.18,
  },
  bass: {
    name: "Bass",
    symbol: "𝄢",
    baseNote: { letterIndex: 4, octave: 2 }, // G2 on the bottom line.
    symbolIndex: 6,
    symbolOffset: -1.60,
  },
};

export const KEY_SIGNATURE_POSITIONS: {
  treble: { sharps: number[]; flats: number[] };
  bass: { sharps: number[]; flats: number[] };
} = {
  treble: {
    sharps: [8, 5, 9, 6, 3, 7, 4], // F, C, G, D, A, E, B
    flats: [4, 7, 3, 6, 2, 5, 1], // B, E, A, D, G, C, F
  },
  bass: {
    sharps: [6, 3, 7, 4, 1, 5, 2], // F, C, G, D, A, E, B
    flats: [2, 5, 1, 4, 0, 3, -1], // B, E, A, D, G, C, F
  },
};

export const AUDIO_CONFIG: AudioConfig = {
  fftSize: 4096,
  smoothing: 0.8,
  minHoldMs: 25,
  minPitchHz: 27.5,
  maxPitchHz: 4186,
  octaveTolerance: 0.03,
  clarityThreshold: 0.9,
  rmsThreshold: 0.015,
};
