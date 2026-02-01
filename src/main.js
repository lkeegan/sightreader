import "./style.css";
import { PitchDetector } from "pitchy";
import { formatNoteLabel, frequencyToNote, noteNameToStaffIndex, staffIndexToNoteName } from "./note-utils.js";

const canvas = document.getElementById("staff");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("start-btn");
const newNoteBtn = document.getElementById("new-note-btn");
const statusEl = document.getElementById("status");
const targetEl = document.getElementById("target-note");
const detectedEl = document.getElementById("detected-note");
const frequencyEl = document.getElementById("frequency");

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

const NOTE_POOL = [
  { name: "C4", midi: 60, staffIndex: -2 },
  { name: "D4", midi: 62, staffIndex: -1 },
  { name: "E4", midi: 64, staffIndex: 0 },
  { name: "F4", midi: 65, staffIndex: 1 },
  { name: "G4", midi: 67, staffIndex: 2 },
  { name: "A4", midi: 69, staffIndex: 3 },
  { name: "H4", midi: 71, staffIndex: 4 },
  { name: "C5", midi: 72, staffIndex: 5 },
  { name: "D5", midi: 74, staffIndex: 6 },
  { name: "E5", midi: 76, staffIndex: 7 },
  { name: "F5", midi: 77, staffIndex: 8 },
  { name: "G5", midi: 79, staffIndex: 9 },
  { name: "A5", midi: 81, staffIndex: 10 },
];

const STAFF_INDEX_BY_NAME = {
  C4: -2,
  D4: -1,
  E4: 0,
  F4: 1,
  G4: 2,
  A4: 3,
  H4: 4,
  C5: 5,
  D5: 6,
  E5: 7,
  F5: 8,
  G5: 9,
  A5: 10,
};

let audioContext = null;
let analyser = null;
let timeData = null;
let detector = null;
let clarity = 0;
let targetNote = null;
let detectedNote = null;
let detectedFrequency = null;
let listening = false;
let pendingNote = null;
let pendingSince = 0;
const MIN_HOLD_MS = 50;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width } = canvas.getBoundingClientRect();
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(320 * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawStaff();
}

function pickRandomNote() {
  const pick = NOTE_POOL[Math.floor(Math.random() * NOTE_POOL.length)];
  targetNote = { ...pick };
  targetEl.textContent = formatNoteLabel(targetNote);
  drawStaff();
}

function staffYForIndex(index) {
  const baseY = STAFF.top + STAFF.lineGap * 4;
  return baseY - index * (STAFF.lineGap / 2);
}

function setTargetByIndex(index) {
  const name = staffIndexToNoteName(index);
  const note = NOTE_POOL.find((entry) => entry.name === name) || { name, staffIndex: index };
  targetNote = { ...note };
  targetEl.textContent = formatNoteLabel(targetNote);
  drawStaff();
}

function getStaffIndex(note) {
  if (Number.isFinite(note.staffIndex)) {
    return note.staffIndex;
  }
  const key = note.baseName || note.name;
  if (key && Object.prototype.hasOwnProperty.call(STAFF_INDEX_BY_NAME, key)) {
    return STAFF_INDEX_BY_NAME[key];
  }
  const computed = key ? noteNameToStaffIndex(key) : null;
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
  ctx.fillText("𝄞", CLEF.x, staffYForIndex(2) - STAFF.lineGap * 0.6);
  ctx.textBaseline = "alphabetic";

  if (targetNote) {
    drawNote(targetNote, detectedNote && detectedNote.name === targetNote.name ? "#2fbf71" : "#1c1b1f");
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

function drawNote(note, color, isDetected = false) {
  const x = STAFF.left + STAFF.width / 2 + (isDetected ? 120 : 0);
  const index = getStaffIndex(note);
  const y = staffYForIndex(index);
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

async function startListening() {
  if (listening) {
    return;
  }

  try {
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
    startBtn.textContent = "Listening";
    startBtn.disabled = true;
    tick();
  } catch (error) {
    statusEl.textContent = "Microphone permission denied";
  }
}

function detectPitch() {
  if (!analyser) return;

  analyser.getFloatTimeDomainData(timeData);

  const [pitch, detectedClarity] = detector.findPitch(timeData, audioContext.sampleRate);
  clarity = detectedClarity;
  if (!pitch || clarity < 0.8) {
    detectedNote = null;
    detectedFrequency = null;
    pendingNote = null;
    pendingSince = 0;
    return;
  }

  detectedFrequency = pitch;
  const baseNote = frequencyToNote(pitch);
  const computedIndex = noteNameToStaffIndex(baseNote.name);
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

  if (detectedNote) {
    detectedEl.textContent = formatNoteLabel(detectedNote);
    frequencyEl.textContent = `${detectedFrequency.toFixed(1)} Hz`;
  } else {
    detectedEl.textContent = "—";
    frequencyEl.textContent = "—";
  }

  drawStaff();
  requestAnimationFrame(tick);
}

startBtn.addEventListener("click", startListening);
newNoteBtn.addEventListener("click", pickRandomNote);
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const baseY = STAFF.top + STAFF.lineGap * 4;
  const index = Math.round((baseY - y) / (STAFF.lineGap / 2));
  setTargetByIndex(index);
});
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
pickRandomNote();
