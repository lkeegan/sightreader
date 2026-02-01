import {
  KEY_SIGNATURES,
  noteNameToStaffIndex,
  signatureAccidentalForLetter,
  type ClefName,
  type KeySignatureKey,
  type Note,
} from "./note-utils";

interface StaffRendererConfig {
  canvas: HTMLCanvasElement;
  clefs: { treble: { baseNote: { letterIndex: number; octave: number }; symbol: string; symbolIndex: number; symbolOffset: number } };
  keySignaturePositions: {
    treble: { sharps: number[]; flats: number[] };
    bass: { sharps: number[]; flats: number[] };
  };
  staffDefaults: { left: number; top: number; width: number; lineGap: number };
  clefStyle: { lineExtension: number };
}

export function createStaffRenderer({
  canvas,
  clefs,
  keySignaturePositions,
  staffDefaults,
  clefStyle,
}: StaffRendererConfig) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  const staff = { ...staffDefaults };

  const staffYForIndex = (index: number) => {
    const baseY = staff.top + staff.lineGap * 4;
    return baseY - index * (staff.lineGap / 2);
  };

  const getStaffIndex = (note: Note, clef: typeof clefs.treble) => {
    if (typeof note.staffIndex === "number") {
      return note.staffIndex;
    }
    const key = note.baseName || note.name;
    const computed = key ? noteNameToStaffIndex(key, clef.baseNote) : null;
    return typeof computed === "number" ? computed : 0;
  };

  const drawLedgerLines = (index: number, x: number) => {
    const lowestLine = 0;
    const highestLine = 8;
    ctx.strokeStyle = "#1c1b1f";
    ctx.lineWidth = 2;

    if (index < lowestLine) {
      for (let step = -2; step >= index; step -= 2) {
        const y = staffYForIndex(step);
        ctx.beginPath();
        ctx.moveTo(x - 18, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
      }
    }

    if (index > highestLine) {
      for (let step = 10; step <= index; step += 2) {
        const y = staffYForIndex(step);
        ctx.beginPath();
        ctx.moveTo(x - 18, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
      }
    }
  };

  const drawNote = (
    note: Note,
    color: string,
    clef: typeof clefs.treble,
    {
      isDetected = false,
      jitter = null,
      offset = null,
    }: {
      isDetected?: boolean;
      jitter?: { x: number; y: number } | null;
      offset?: { x: number; y: number } | null;
    } = {},
  ) => {
    const x =
      staff.left +
      staff.width / 2 +
      (isDetected ? 120 : 0) +
      (jitter ? jitter.x : 0) +
      (offset ? offset.x : 0);
    const index = getStaffIndex(note, clef);
    const y =
      staffYForIndex(index) +
      (jitter ? jitter.y : 0) +
      (offset ? offset.y : 0);
    const stemDown = index >= 4;

    drawLedgerLines(index, x);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (stemDown) {
      ctx.moveTo(x - 10, y + 2);
      ctx.lineTo(x - 10, y + 42);
    } else {
      ctx.moveTo(x + 10, y - 2);
      ctx.lineTo(x + 10, y - 42);
    }
    ctx.stroke();

    if (note.accidental) {
      ctx.font = note.accidental === "b" ? "57px serif" : "42px serif";
      ctx.fillStyle = color;
      const symbol =
        note.accidental === "b" ? "♭" : note.accidental === "natural" ? "♮" : "#";
      const xOffset = note.accidental === "b" ? 34 : 34;
      const yOffset = note.accidental === "b" ? 6 : 14;
      const adjustedY = note.accidental === "natural" ? yOffset - staff.lineGap * 0.5 : yOffset;
      ctx.fillText(symbol, x - xOffset, y + adjustedY);
    }
  };

  const drawKeySignature = (clef: typeof clefs.treble, keySignature: KeySignatureKey) => {
    const signature = KEY_SIGNATURES[keySignature];
    if (!signature || signature.count === 0) return;
    const positions =
      clef === clefs.treble ? keySignaturePositions.treble : keySignaturePositions.bass;
    const indices = signature.type === "sharp" ? positions.sharps : positions.flats;
    const xBase = staff.left + 36;
    ctx.fillStyle = "#1c1b1f";
    for (let i = 0; i < signature.count; i += 1) {
      const index = indices[i];
      const x = xBase + i * 22;
      const y = staffYForIndex(index);
      const yOffset = signature.type === "sharp" ? 12 : 6;
      ctx.font = signature.type === "flat" ? "57px serif" : "42px serif";
      ctx.fillText(signature.type === "sharp" ? "♯" : "♭", x, y + yOffset);
    }
  };

  const formatDetectedNoteForKey = (
    note: Note,
    clef: typeof clefs.treble,
    keySignature: KeySignatureKey,
  ) => {
    const signature = KEY_SIGNATURES[keySignature];
    const match = /^([A-GHB])([#b]?)(-?\d+)$/.exec(note.name);
    if (!signature || !match) return note;
    const [, letter, accidental, octave] = match;

    let name = note.name;
    let staffIndex = getStaffIndex(note, clef);
    let displayAccidental = note.accidental || null;

    if (signature.type === "flat" && accidental === "#") {
      const flatMap: Record<string, string> = {
        "C#": "Db",
        "D#": "Eb",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb",
      };
      const mapped = flatMap[`${letter}#`];
      if (mapped) {
        name = `${mapped}${octave}`;
        const mappedIndex = noteNameToStaffIndex(name, clef.baseNote);
        if (typeof mappedIndex === "number") {
          staffIndex = mappedIndex;
        }
        displayAccidental = "b";
      }
    }

    if (!displayAccidental) {
      const signatureAcc = signatureAccidentalForLetter(letter, keySignature);
      if (signatureAcc) {
        displayAccidental = "natural";
      }
    }

    return {
      ...note,
      name,
      staffIndex,
      accidental: displayAccidental,
    };
  };

  const draw = ({
    clef,
    keySignature,
    targetNote,
    detectedNote,
    isMatch,
    jitter,
    targetOffset,
  }: {
    clef: typeof clefs.treble;
    keySignature: KeySignatureKey;
    targetNote: Note | null;
    detectedNote: Note | null;
    isMatch: boolean;
    jitter?: { x: number; y: number } | null;
    targetOffset?: { x: number; y: number } | null;
  }) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(1, 1);

    ctx.fillStyle = "#fff7e8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#1c1b1f";
    ctx.lineWidth = 2;

    for (let i = 0; i < 5; i += 1) {
      const y = staff.top + i * staff.lineGap;
      ctx.beginPath();
      ctx.moveTo(staff.left - clefStyle.lineExtension, y);
      ctx.lineTo(staff.left + staff.width, y);
      ctx.stroke();
    }

    const clefX = staff.left - clefStyle.lineExtension + 12;
    ctx.font = "96px serif";
    ctx.fillStyle = "#1c1b1f";
    ctx.textBaseline = "middle";
    ctx.fillText(
      clef.symbol,
      clefX,
      staffYForIndex(clef.symbolIndex) - staff.lineGap * clef.symbolOffset,
    );
    ctx.textBaseline = "alphabetic";

    drawKeySignature(clef, keySignature);

    if (targetNote) {
      drawNote(targetNote, isMatch ? "#2fbf71" : "#1c1b1f", clef, {
        jitter: isMatch ? jitter : null,
        offset: isMatch ? targetOffset : null,
      });
    }

    if (detectedNote && (!targetNote || !isMatch)) {
      drawNote(formatDetectedNoteForKey(detectedNote, clef, keySignature), "#f05a5a", clef, {
        isDetected: true,
      });
    }

    ctx.restore();
  };

  const resize = (stageHeight: number) => {
    const ratio = window.devicePixelRatio || 1;
    const { width } = canvas.getBoundingClientRect();
    const desiredHeight = Math.max(420, stageHeight - 24);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(desiredHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const viewWidth = width;
    const viewHeight = desiredHeight;
    staff.width = Math.min(900, viewWidth - 180);
    staff.left = Math.max(40, (viewWidth - staff.width) / 2);
    const staffHeight = staff.lineGap * 4;
    staff.top = Math.max(60, (viewHeight - staffHeight) / 2);
  };

  return {
    draw,
    resize,
    getStaffIndex,
  };
}
