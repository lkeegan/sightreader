import "./style.css";
import { PitchDetector } from "pitchy";
import { formatNoteLabel, frequencyToNote, noteNameToStaffIndex, staffIndexToNoteName } from "./note-utils.js";

const canvas = document.getElementById("staff");
const ctx = canvas.getContext("2d");

const trebleBtn = document.getElementById("clef-treble");
const bassBtn = document.getElementById("clef-bass");
const statusEl = document.getElementById("status");
const targetEl = document.getElementById("target-note");
const detectedEl = document.getElementById("detected-note");
const frequencyEl = document.getElementById("frequency");
const celebrationEl = document.getElementById("celebration");
const micFallbackBtn = document.getElementById("mic-fallback");

const STAFF = {
  left: 110,
  top: 90,
  width: 680,
  lineGap: 18,
};
const CLEF = {
  x: STAFF.left - 30,
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
const PITCH_WINDOW = 9;
let targetNote = null;
let detectedNote = null;
let detectedFrequency = null;
let listening = false;
let pendingNote = null;
let pendingSince = 0;
const MIN_HOLD_MS = 50;
const MIN_PITCH_HZ = 27.5;
const MAX_PITCH_HZ = 4186;
const OCTAVE_TOLERANCE = 0.03;
const CLARITY_THRESHOLD = 0.9;
let celebrationUntil = 0;
let nextNoteAt = 0;
let matchLock = false;

function buildNotePool() {
  const pool = [];
  for (let index = -6; index <= 12; index += 1) {
    const name = staffIndexToNoteName(index, currentClef.baseNote);
    pool.push({ name, staffIndex: index });
  }
  return pool;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width } = canvas.getBoundingClientRect();
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(320 * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawStaff();
}

function pickRandomNote() {
  const pick = notePool[Math.floor(Math.random() * notePool.length)];
  targetNote = { ...pick };
  targetEl.textContent = formatNoteLabel(targetNote);
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
  targetEl.textContent = formatNoteLabel(targetNote);
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

  ctx.font = "96px serif";
  ctx.fillStyle = "#1c1b1f";
  ctx.textBaseline = "middle";
  ctx.fillText(
    currentClef.symbol,
    CLEF.x,
    staffYForIndex(currentClef.symbolIndex) - STAFF.lineGap * currentClef.symbolOffset,
  );
  ctx.textBaseline = "alphabetic";

  if (targetNote) {
    const isMatch = detectedNote && detectedNote.name === targetNote.name;
    drawNote(
      targetNote,
      isMatch ? "#2fbf71" : "#1c1b1f",
      false,
      isMatch ? getCelebrationJitter() : null,
    );
  }

  if (detectedNote && (!targetNote || detectedNote.name !== targetNote.name)) {
    drawNote(detectedNote, "#f05a5a", true);
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
    ctx.font = "18px serif";
    ctx.fillStyle = color;
    ctx.fillText(note.accidental === "b" ? "♭" : "#", x - 22, y + 6);
  }
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
  celebrationEl.textContent = "Well done!";
  celebrationEl.classList.add("show");
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

  const [pitch, detectedClarity] = detector.findPitch(timeData, audioContext.sampleRate);
  clarity = detectedClarity;
  if (!pitch || clarity < CLARITY_THRESHOLD || pitch < MIN_PITCH_HZ || pitch > MAX_PITCH_HZ) {
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
  if (!pendingNote || pendingNote.name !== candidateNote.name) {
    pendingNote = candidateNote;
    pendingSince = now;
  }

  if (pendingNote && now - pendingSince >= MIN_HOLD_MS) {
    detectedNote = pendingNote;
  }
}

function tick() {
  if (!listening) return;

  detectPitch();

  const now = performance.now();
  if (celebrationUntil && now > celebrationUntil) {
    celebrationEl.classList.remove("show");
  }
  if (matchLock && now > nextNoteAt) {
    matchLock = false;
    celebrationUntil = 0;
    pickRandomNote();
  }

  if (detectedNote) {
    detectedEl.textContent = formatNoteLabel(detectedNote);
    frequencyEl.textContent = `${detectedFrequency.toFixed(1)} Hz`;
  } else {
    detectedEl.textContent = "—";
    frequencyEl.textContent = "—";
  }

  drawStaff();

  if (!matchLock && detectedNote && targetNote && detectedNote.name === targetNote.name) {
    triggerCelebration();
  }

  requestAnimationFrame(tick);
}

function setClef(nextClef) {
  currentClef = nextClef;
  trebleBtn.classList.toggle("active", currentClef === CLEFS.treble);
  trebleBtn.setAttribute("aria-pressed", currentClef === CLEFS.treble);
  bassBtn.classList.toggle("active", currentClef === CLEFS.bass);
  bassBtn.setAttribute("aria-pressed", currentClef === CLEFS.bass);
  notePool = buildNotePool();
  if (targetNote) {
    const index = noteNameToStaffIndex(targetNote.name, currentClef.baseNote);
    if (Number.isFinite(index)) {
      setTargetByIndex(index);
      return;
    }
  }
  pickRandomNote();
}

trebleBtn.addEventListener("click", () => setClef(CLEFS.treble));
bassBtn.addEventListener("click", () => setClef(CLEFS.bass));
micFallbackBtn.addEventListener("click", startListening);
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const baseY = STAFF.top + STAFF.lineGap * 4;
  const index = Math.round((baseY - y) / (STAFF.lineGap / 2));
  setTargetByIndex(index);
});
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
notePool = buildNotePool();
setClef(CLEFS.treble);
startListening();
