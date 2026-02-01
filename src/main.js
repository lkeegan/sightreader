import "./style.css";
import confetti from "canvas-confetti";
import { PitchDetector } from "pitchy";
import {
  DEFAULT_SESSION_NOTES,
  KEY_SIGNATURES,
  adjustNoteForKeyChange,
  buildNotePoolForLevel,
  effectiveNoteName,
  frequencyToNote,
  noteNameToMidi,
  noteNameToStaffIndex,
  shouldEndSession,
  signatureAccidentalForLetter,
  staffIndexToNoteName,
} from "./note-utils.js";

const dom = {
  canvas: document.getElementById("staff"),
  stage: document.querySelector(".stage"),
  controls: document.querySelector(".controls"),
  header: document.getElementById("flow-header"),
  clefTreble: document.getElementById("clef-treble"),
  clefBass: document.getElementById("clef-bass"),
  sigSharp: document.getElementById("sig-sharp"),
  sigSharp2: document.getElementById("sig-sharp-2"),
  sigFlat: document.getElementById("sig-flat"),
  sigFlat2: document.getElementById("sig-flat-2"),
  sigNatural: document.getElementById("sig-natural"),
  level1: document.getElementById("level-1"),
  level2: document.getElementById("level-2"),
  level3: document.getElementById("level-3"),
  status: document.getElementById("status"),
  celebration: document.getElementById("celebration"),
  micFallback: document.getElementById("mic-fallback"),
  confettiCanvas: document.getElementById("confetti-canvas"),
  endScreen: document.getElementById("end-screen"),
  redo: document.getElementById("redo-session"),
  restart: document.getElementById("restart-flow"),
  sessionBar: document.getElementById("session-bar"),
  progressLabel: document.getElementById("progress-label"),
  progressFill: document.getElementById("progress-fill"),
  stepClef: document.querySelector(".clef-step"),
  stepKey: document.querySelector(".signature-toggle"),
  stepLevel: document.querySelector(".level-toggle"),
};

const ctx = dom.canvas.getContext("2d");
const confettiInstance = dom.confettiCanvas
  ? confetti.create(dom.confettiCanvas, { resize: true, useWorker: true })
  : confetti;

const STAFF = {
  left: 110,
  top: 130,
  width: 680,
  lineGap: 18,
};
const CLEF = {
  lineExtension: 40,
};

const CLEFS = {
  treble: {
    name: "Treble",
    symbol: "𝄞",
    baseNote: { letterIndex: 2, octave: 4 }, // E4 on the bottom line.
    symbolIndex: 2,
    symbolOffset: 0.6,
  },
  bass: {
    name: "Bass",
    symbol: "𝄢",
    baseNote: { letterIndex: 4, octave: 2 }, // G2 on the bottom line.
    symbolIndex: 6,
    symbolOffset: -1.55,
  },
};

let currentClef = CLEFS.treble;
let notePool = [];

let audioContext = null;
let analyser = null;
let timeData = null;
let detector = null;
let clarity = 0;
const recentPitches = [];
const PITCH_WINDOW = 5;
let targetNote = null;
let detectedNote = null;
let detectedFrequency = null;
let listening = false;
let pendingNote = null;
let pendingSince = 0;
const MIN_HOLD_MS = 25;
const MIN_PITCH_HZ = 27.5;
const MAX_PITCH_HZ = 4186;
const OCTAVE_TOLERANCE = 0.03;
const CLARITY_THRESHOLD = 0.9;
const RMS_THRESHOLD = 0.015;
let celebrationUntil = 0;
let nextNoteAt = 0;
let matchLock = false;
let nextNoteTimer = null;
let inputLocked = false;
let keySignature = "natural";
let correctCount = 0;
let incorrectCount = 0;
let lastWrongMidi = null;
let lastWrongAt = 0;
const WRONG_COOLDOWN_MS = 350;
let currentLevel = 1;
let notesCompleted = 0;
const NOTES_PER_SESSION = DEFAULT_SESSION_NOTES;
let sessionActive = false;

const KEY_SIGNATURE_POSITIONS = {
  treble: {
    sharps: [8, 5, 9, 6, 3, 7, 4], // F, C, G, D, A, E, B
    flats: [4, 7, 3, 6, 2, 5, 1], // B, E, A, D, G, C, F
  },
  bass: {
    sharps: [6, 3, 7, 4, 1, 5, 2], // F, C, G, D, A, E, B
    flats: [2, 5, 1, 4, 0, 3, -1], // B, E, A, D, G, C, F
  },
};


function buildNotePool() {
  const clefName = currentClef === CLEFS.treble ? "treble" : "bass";
  return buildNotePoolForLevel(clefName, currentClef.baseNote, currentLevel);
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width } = canvas.getBoundingClientRect();
  const stageHeight = stageEl ? stageEl.getBoundingClientRect().height : 420;
  const desiredHeight = Math.max(420, stageHeight - 24);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(desiredHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const viewWidth = width;
  const viewHeight = desiredHeight;
  STAFF.width = Math.min(900, viewWidth - 180);
  STAFF.left = Math.max(40, (viewWidth - STAFF.width) / 2);
  const staffHeight = STAFF.lineGap * 4;
  STAFF.top = Math.max(60, (viewHeight - staffHeight) / 2);
  drawStaff();
}

function pickRandomNote() {
  const pick = notePool[Math.floor(Math.random() * notePool.length)];
  targetNote = { ...pick };
  warningShownForNote = false;
  drawStaff();
}

function staffYForIndex(index) {
  const baseY = STAFF.top + STAFF.lineGap * 4;
  return baseY - index * (STAFF.lineGap / 2);
}

function setTargetByIndex(index) {
  const name = staffIndexToNoteName(index, currentClef.baseNote);
  const note = notePool.find((entry) => entry.name === name) || { name, staffIndex: index };
  targetNote = { ...note };
  warningShownForNote = false;
  drawStaff();
}

function getStaffIndex(note) {
  if (Number.isFinite(note.staffIndex)) {
    return note.staffIndex;
  }
  const key = note.baseName || note.name;
  const computed = key ? noteNameToStaffIndex(key, currentClef.baseNote) : null;
  return Number.isFinite(computed) ? computed : 0;
}

function drawStaff() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(1, 1);

  ctx.fillStyle = "#fff7e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#1c1b1f";
  ctx.lineWidth = 2;

  for (let i = 0; i < 5; i += 1) {
    const y = STAFF.top + i * STAFF.lineGap;
    ctx.beginPath();
    ctx.moveTo(STAFF.left - CLEF.lineExtension, y);
    ctx.lineTo(STAFF.left + STAFF.width, y);
    ctx.stroke();
  }

  const clefX = STAFF.left - CLEF.lineExtension + 12;
  ctx.font = "96px serif";
  ctx.fillStyle = "#1c1b1f";
  ctx.textBaseline = "middle";
  ctx.fillText(
    currentClef.symbol,
    clefX,
    staffYForIndex(currentClef.symbolIndex) - STAFF.lineGap * currentClef.symbolOffset,
  );
  ctx.textBaseline = "alphabetic";

  drawKeySignature();

  if (targetNote) {
    const isMatch = detectedNote && notesMatch(detectedNote, targetNote);
    drawNote(
      targetNote,
      isMatch ? "#2fbf71" : "#1c1b1f",
      false,
      isMatch ? getCelebrationJitter() : null,
    );
  }

  if (detectedNote && (!targetNote || !notesMatch(detectedNote, targetNote))) {
    drawNote(formatDetectedNoteForKey(detectedNote), "#f05a5a", true);
  }

  ctx.restore();
}

function drawLedgerLines(index, x) {
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
}

function drawKeySignature() {
  const signature = KEY_SIGNATURES[keySignature];
  if (!signature || signature.count === 0) return;
  const positions =
    currentClef === CLEFS.treble ? KEY_SIGNATURE_POSITIONS.treble : KEY_SIGNATURE_POSITIONS.bass;
  const indices = signature.type === "sharp" ? positions.sharps : positions.flats;
  const xBase = STAFF.left + 36;
  ctx.fillStyle = "#1c1b1f";
  for (let i = 0; i < signature.count; i += 1) {
    const index = indices[i];
    const x = xBase + i * 22;
    const y = staffYForIndex(index);
    const yOffset = signature.type === "sharp" ? 12 : 6;
    ctx.font = signature.type === "flat" ? "57px serif" : "42px serif";
    ctx.fillText(signature.type === "sharp" ? "♯" : "♭", x, y + yOffset);
  }
}

function setKeySignature(nextSignature) {
  const previousSignature = keySignature;
  keySignature = nextSignature;
  sigNaturalBtn.classList.toggle("active", keySignature === "natural");
  sigNaturalBtn.setAttribute("aria-pressed", keySignature === "natural");
  sigSharpBtn.classList.toggle("active", keySignature === "sharp");
  sigSharpBtn.setAttribute("aria-pressed", keySignature === "sharp");
  sigSharp2Btn.classList.toggle("active", keySignature === "sharp2");
  sigSharp2Btn.setAttribute("aria-pressed", keySignature === "sharp2");
  sigFlatBtn.classList.toggle("active", keySignature === "flat");
  sigFlatBtn.setAttribute("aria-pressed", keySignature === "flat");
  sigFlat2Btn.classList.toggle("active", keySignature === "flat2");
  sigFlat2Btn.setAttribute("aria-pressed", keySignature === "flat2");
  if (targetNote) {
    targetNote = adjustNoteForKeyChange(targetNote, previousSignature, keySignature, currentClef.baseNote);
  }
  drawStaff();
}

function drawNote(note, color, isDetected = false, jitter = null) {
  const x = STAFF.left + STAFF.width / 2 + (isDetected ? 120 : 0) + (jitter ? jitter.x : 0);
  const index = getStaffIndex(note);
  const y = staffYForIndex(index) + (jitter ? jitter.y : 0);
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
    const adjustedY = note.accidental === "natural" ? yOffset - STAFF.lineGap * 0.5 : yOffset;
    ctx.fillText(symbol, x - xOffset, y + adjustedY);
  }
}

function formatDetectedNoteForKey(note) {
  const signature = KEY_SIGNATURES[keySignature];
  const match = /^([A-GHB])([#b]?)(-?\d+)$/.exec(note.name);
  if (!signature || !match) return note;
  const [, letter, accidental, octave] = match;

  let name = note.name;
  let staffIndex = getStaffIndex(note);
  let displayAccidental = note.accidental || null;

  if (signature.type === "flat" && accidental === "#") {
    const flatMap = {
      "C#": "Db",
      "D#": "Eb",
      "F#": "Gb",
      "G#": "Ab",
      "A#": "Bb",
    };
    const mapped = flatMap[`${letter}#`];
    if (mapped) {
      name = `${mapped}${octave}`;
      staffIndex = noteNameToStaffIndex(name, currentClef.baseNote);
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
}

function notesMatch(detected, target) {
  const targetName = effectiveNoteName(target, keySignature);
  const targetMidi = targetName ? noteNameToMidi(targetName) : null;
  const detectedMidi = Number.isFinite(detected?.midi)
    ? detected.midi
    : detected?.name
      ? noteNameToMidi(detected.name)
      : null;
  if (targetMidi === null || detectedMidi === null) return false;
  return targetMidi === detectedMidi;
}

function getCelebrationJitter() {
  const now = performance.now();
  if (now > celebrationUntil) return null;
  const wobble = (now - (celebrationUntil - 700)) / 700;
  const amplitude = 6;
  return {
    x: Math.sin(wobble * Math.PI * 6) * amplitude,
    y: Math.cos(wobble * Math.PI * 5) * amplitude,
  };
}

function triggerCelebration() {
  const now = performance.now();
  celebrationUntil = now + 700;
  nextNoteAt = now + 1000;
  matchLock = true;
  inputLocked = true;
  celebrationEl.textContent = "Well done!";
  celebrationEl.classList.add("show");

  correctCount += 1;
  notesCompleted += 1;
  updateProgress();
  incorrectCount = 0;
  lastWrongMidi = null;
  lastWrongAt = 0;
  if (shouldEndSession(notesCompleted, NOTES_PER_SESSION)) {
    if (nextNoteTimer) {
      clearTimeout(nextNoteTimer);
    }
    nextNoteTimer = setTimeout(() => {
      endSession();
    }, 1000);
  } else {
    if (nextNoteTimer) {
      clearTimeout(nextNoteTimer);
    }
    nextNoteTimer = setTimeout(() => {
      matchLock = false;
      celebrationUntil = 0;
      inputLocked = false;
      pickRandomNote();
    }, 1000);
  }
}

function endSession() {
  sessionActive = false;
  matchLock = true;
  inputLocked = true;
  if (endScreenEl) {
    endScreenEl.classList.add("show");
  }
  const end = performance.now() + 3000;
  const confettiColors = ["#ff3b3b", "#1f7bff", "#ffffff"];
  (function burst() {
    confettiInstance({
      particleCount: 60,
      spread: 100,
      startVelocity: 90,
      ticks: 70,
      gravity: 0.8,
      scalar: 1.15,
      colors: confettiColors,
      origin: { x: Math.random(), y: 0 },
    });
    if (performance.now() < end) {
      requestAnimationFrame(burst);
    }
  })();
  if (redoBtn) {
    redoBtn.classList.remove("show");
    setTimeout(() => {
      redoBtn.classList.add("show");
    }, 3000);
  }
}

function startSession() {
  notesCompleted = 0;
  correctCount = 0;
  incorrectCount = 0;
  sessionActive = true;
  matchLock = false;
  inputLocked = false;
  notePool = buildNotePool();
  updateProgress();
  pickRandomNote();
}

function updateProgress() {
  if (!progressLabelEl || !progressFillEl) return;
  progressLabelEl.textContent = `${notesCompleted} / ${NOTES_PER_SESSION}`;
  progressFillEl.style.width = `${(notesCompleted / NOTES_PER_SESSION) * 100}%`;
}

function setFlow(step) {
  clefStep?.classList.toggle("active", step === "clef");
  keyStep?.classList.toggle("active", step === "key");
  levelStep?.classList.toggle("active", step === "level");
  const inSession = step === "session";
  stageEl?.classList.toggle("hidden", !inSession);
  sessionBarEl?.classList.toggle("hidden", !inSession);
  statusEl?.classList.toggle("hidden", !inSession);
  micFallbackBtn?.classList.toggle("hidden", !inSession);
  controlsEl?.classList.toggle("hidden", inSession);
  controlsEl?.classList.toggle("clef-only", step !== "session");
  headerEl?.classList.toggle("hidden", inSession);
  sessionActive = step === "session";
  if (inSession) {
    requestAnimationFrame(resizeCanvas);
  }
}

async function startListening() {
  if (listening) {
    return;
  }

  try {
    if (micFallbackBtn) {
      micFallbackBtn.classList.add("hidden");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);
    detector = PitchDetector.forFloat32Array(analyser.fftSize);
    listening = true;
    statusEl.textContent = "Listening…";
    tick();
  } catch (error) {
    statusEl.textContent = "Tap to enable microphone";
    if (micFallbackBtn) {
      micFallbackBtn.classList.remove("hidden");
    }
  }
}

function detectPitch() {
  if (!analyser) return;

  analyser.getFloatTimeDomainData(timeData);
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const sample = timeData[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);

  const [pitch, detectedClarity] = detector.findPitch(timeData, audioContext.sampleRate);
  clarity = detectedClarity;
  if (
    !pitch ||
    clarity < CLARITY_THRESHOLD ||
    pitch < MIN_PITCH_HZ ||
    pitch > MAX_PITCH_HZ ||
    rms < RMS_THRESHOLD
  ) {
    detectedNote = null;
    detectedFrequency = null;
    pendingNote = null;
    pendingSince = 0;
    recentPitches.length = 0;
    return;
  }

  let adjustedPitch = pitch;
  if (detectedFrequency) {
    if (Math.abs(adjustedPitch * 2 - detectedFrequency) / detectedFrequency < OCTAVE_TOLERANCE) {
      adjustedPitch *= 2;
    } else if (Math.abs(adjustedPitch / 2 - detectedFrequency) / detectedFrequency < OCTAVE_TOLERANCE) {
      adjustedPitch /= 2;
    }
  }

  recentPitches.push(adjustedPitch);
  if (recentPitches.length > PITCH_WINDOW) {
    recentPitches.shift();
  }

  const sorted = [...recentPitches].sort((a, b) => a - b);
  const medianPitch = sorted[Math.floor(sorted.length / 2)];

  detectedFrequency = medianPitch;
  const baseNote = frequencyToNote(medianPitch);
  const computedIndex = noteNameToStaffIndex(baseNote.name, currentClef.baseNote);
  const candidateNote = {
    ...baseNote,
    staffIndex: Number.isFinite(computedIndex) ? computedIndex : undefined,
  };

  const now = performance.now();
  if (!pendingNote || pendingNote.midi !== candidateNote.midi) {
    pendingNote = candidateNote;
    pendingSince = now;
  }

  if (pendingNote && now - pendingSince >= MIN_HOLD_MS) {
    detectedNote = pendingNote;
  }
}

function tick() {
  if (!listening) return;

  if (inputLocked) {
    drawStaff();
    requestAnimationFrame(tick);
    return;
  }

  detectPitch();

  const now = performance.now();
  if (celebrationUntil && now > celebrationUntil) {
    celebrationEl.classList.remove("show");
  }
  if (matchLock && now > nextNoteAt) {
    matchLock = false;
    celebrationUntil = 0;
  }

  drawStaff();

  if (!matchLock && detectedNote && targetNote) {
    if (notesMatch(detectedNote, targetNote)) {
      triggerCelebration();
    } else {
      const midi = Number.isFinite(detectedNote.midi) ? detectedNote.midi : noteNameToMidi(detectedNote.name);
      if (midi !== null && (midi !== lastWrongMidi || now - lastWrongAt > WRONG_COOLDOWN_MS)) {
        incorrectCount += 1;
        lastWrongMidi = midi;
        lastWrongAt = now;
        // No warning overlay currently.
      }
    }
  }

  requestAnimationFrame(tick);
}

function setClef(nextClef) {
  currentClef = nextClef;
  trebleBtn.classList.toggle("active", currentClef === CLEFS.treble);
  trebleBtn.setAttribute("aria-pressed", currentClef === CLEFS.treble);
  bassBtn.classList.toggle("active", currentClef === CLEFS.bass);
  bassBtn.setAttribute("aria-pressed", currentClef === CLEFS.bass);
}

function setLevel(nextLevel) {
  currentLevel = nextLevel;
  level1Btn.classList.toggle("active", currentLevel === 1);
  level1Btn.setAttribute("aria-pressed", currentLevel === 1);
  level2Btn.classList.toggle("active", currentLevel === 2);
  level2Btn.setAttribute("aria-pressed", currentLevel === 2);
  level3Btn.classList.toggle("active", currentLevel === 3);
  level3Btn.setAttribute("aria-pressed", currentLevel === 3);
}

trebleBtn.addEventListener("click", () => {
  setClef(CLEFS.treble);
  setFlow("key");
});
bassBtn.addEventListener("click", () => {
  setClef(CLEFS.bass);
  setFlow("key");
});
sigSharpBtn.addEventListener("click", () => {
  setKeySignature("sharp");
  setFlow("level");
});
sigSharp2Btn.addEventListener("click", () => {
  setKeySignature("sharp2");
  setFlow("level");
});
sigFlatBtn.addEventListener("click", () => {
  setKeySignature("flat");
  setFlow("level");
});
sigFlat2Btn.addEventListener("click", () => {
  setKeySignature("flat2");
  setFlow("level");
});
sigNaturalBtn.addEventListener("click", () => {
  setKeySignature("natural");
  setFlow("level");
});
level1Btn.addEventListener("click", () => {
  setLevel(1);
  setFlow("session");
  startSession();
});
level2Btn.addEventListener("click", () => {
  setLevel(2);
  setFlow("session");
  startSession();
});
level3Btn.addEventListener("click", () => {
  setLevel(3);
  setFlow("session");
  startSession();
});
restartBtn?.addEventListener("click", () => {
  setFlow("clef");
});
redoBtn?.addEventListener("click", () => {
  endScreenEl?.classList.remove("show");
  setFlow("clef");
});
micFallbackBtn.addEventListener("click", startListening);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
setClef(CLEFS.treble);
setKeySignature("natural");
setLevel(1);
setFlow("clef");
startListening();
