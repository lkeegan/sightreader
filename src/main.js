import "./style.css";
import confetti from "canvas-confetti";
import { PitchDetector } from "pitchy";
import {
  DEFAULT_SESSION_NOTES,
  adjustNoteForKeyChange,
  buildNotePoolForLevel,
  effectiveNoteName,
  frequencyToNote,
  noteNameToMidi,
  noteNameToStaffIndex,
  shouldEndSession,
} from "./note-utils.js";
import { AUDIO_CONFIG, CLEF_STYLE, CLEFS, KEY_SIGNATURE_POSITIONS, STAFF_DEFAULT } from "./config.js";
import { createStaffRenderer } from "./staff-renderer.js";

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
  stepKey: document.querySelector(".key-step"),
  stepLevel: document.querySelector(".level-step"),
};

const confettiInstance = dom.confettiCanvas
  ? confetti.create(dom.confettiCanvas, { resize: true, useWorker: true })
  : confetti;

const AUDIO = AUDIO_CONFIG;

const SESSION = {
  notesPerSession: DEFAULT_SESSION_NOTES,
  nextNoteDelayMs: 1000,
  confettiMs: 3000,
};

const setPressed = (button, isPressed) => {
  if (!button) return;
  button.classList.toggle("active", isPressed);
  button.setAttribute("aria-pressed", String(isPressed));
};

const setHidden = (element, hidden) => {
  if (!element) return;
  element.classList.toggle("hidden", hidden);
};

let currentClef = CLEFS.treble;
let notePool = [];

let audioContext = null;
let analyser = null;
let timeData = null;
let detector = null;
const recentPitches = [];
const PITCH_WINDOW = 5;
let targetNote = null;
let detectedNote = null;
let detectedFrequency = null;
let listening = false;
let pendingNote = null;
let pendingSince = 0;
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
const NOTES_PER_SESSION = SESSION.notesPerSession;

const renderer = createStaffRenderer({
  canvas: dom.canvas,
  clefs: CLEFS,
  keySignaturePositions: KEY_SIGNATURE_POSITIONS,
  staffDefaults: STAFF_DEFAULT,
  clefStyle: CLEF_STYLE,
});


function buildNotePool() {
  const clefName = currentClef === CLEFS.treble ? "treble" : "bass";
  return buildNotePoolForLevel(clefName, currentClef.baseNote, currentLevel);
}

function resizeCanvas() {
  const stageHeight = dom.stage ? dom.stage.getBoundingClientRect().height : 420;
  renderer.resize(stageHeight);
  drawStaff();
}

function pickRandomNote() {
  const pick = notePool[Math.floor(Math.random() * notePool.length)];
  targetNote = { ...pick };
  drawStaff();
}

function drawStaff() {
  const isMatch = detectedNote && targetNote && notesMatch(detectedNote, targetNote);
  renderer.draw({
    clef: currentClef,
    keySignature,
    targetNote,
    detectedNote,
    isMatch,
    jitter: isMatch ? getCelebrationJitter() : null,
  });
}

function setKeySignature(nextSignature) {
  const previousSignature = keySignature;
  keySignature = nextSignature;
  setPressed(dom.sigNatural, keySignature === "natural");
  setPressed(dom.sigSharp, keySignature === "sharp");
  setPressed(dom.sigSharp2, keySignature === "sharp2");
  setPressed(dom.sigFlat, keySignature === "flat");
  setPressed(dom.sigFlat2, keySignature === "flat2");
  if (targetNote) {
    targetNote = adjustNoteForKeyChange(targetNote, previousSignature, keySignature, currentClef.baseNote);
  }
  drawStaff();
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
  dom.celebration.textContent = "Well done!";
  dom.celebration.classList.add("show");

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
    }, SESSION.nextNoteDelayMs);
  } else {
    if (nextNoteTimer) {
      clearTimeout(nextNoteTimer);
    }
    nextNoteTimer = setTimeout(() => {
      matchLock = false;
      celebrationUntil = 0;
      inputLocked = false;
      pickRandomNote();
    }, SESSION.nextNoteDelayMs);
  }
}

function endSession() {
  matchLock = true;
  inputLocked = true;
  dom.endScreen?.classList.add("show");
  const end = performance.now() + SESSION.confettiMs;
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
  if (dom.redo) {
    dom.redo.classList.remove("show");
    setTimeout(() => {
      dom.redo.classList.add("show");
    }, SESSION.confettiMs);
  }
}

function startSession() {
  notesCompleted = 0;
  correctCount = 0;
  incorrectCount = 0;
  matchLock = false;
  inputLocked = false;
  notePool = buildNotePool();
  updateProgress();
  pickRandomNote();
}

function updateProgress() {
  if (!dom.progressLabel || !dom.progressFill) return;
  dom.progressLabel.textContent = `${notesCompleted} / ${NOTES_PER_SESSION}`;
  dom.progressFill.style.width = `${(notesCompleted / NOTES_PER_SESSION) * 100}%`;
}

function setFlow(step) {
  dom.stepClef?.classList.toggle("active", step === "clef");
  dom.stepKey?.classList.toggle("active", step === "key");
  dom.stepLevel?.classList.toggle("active", step === "level");
  const inSession = step === "session";
  setHidden(dom.stage, !inSession);
  setHidden(dom.sessionBar, !inSession);
  setHidden(dom.status, !inSession);
  setHidden(dom.micFallback, !inSession);
  setHidden(dom.controls, inSession);
  dom.controls?.classList.toggle("clef-only", step !== "session");
  setHidden(dom.header, inSession);
  if (inSession) {
    requestAnimationFrame(resizeCanvas);
  }
}

async function startListening() {
  if (listening) {
    return;
  }

  try {
    dom.micFallback?.classList.add("hidden");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = AUDIO.fftSize;
    analyser.smoothingTimeConstant = AUDIO.smoothing;
    source.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);
    detector = PitchDetector.forFloat32Array(analyser.fftSize);
    listening = true;
    dom.status.textContent = "Listening…";
    tick();
  } catch (error) {
    dom.status.textContent = "Tap to enable microphone";
    dom.micFallback?.classList.remove("hidden");
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
    clarity < AUDIO.clarityThreshold ||
    pitch < AUDIO.minPitchHz ||
    pitch > AUDIO.maxPitchHz ||
    rms < AUDIO.rmsThreshold
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
    if (Math.abs(adjustedPitch * 2 - detectedFrequency) / detectedFrequency < AUDIO.octaveTolerance) {
      adjustedPitch *= 2;
    } else if (Math.abs(adjustedPitch / 2 - detectedFrequency) / detectedFrequency < AUDIO.octaveTolerance) {
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

  if (pendingNote && now - pendingSince >= AUDIO.minHoldMs) {
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
    dom.celebration.classList.remove("show");
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
  setPressed(dom.clefTreble, currentClef === CLEFS.treble);
  setPressed(dom.clefBass, currentClef === CLEFS.bass);
}

function setLevel(nextLevel) {
  currentLevel = nextLevel;
  setPressed(dom.level1, currentLevel === 1);
  setPressed(dom.level2, currentLevel === 2);
  setPressed(dom.level3, currentLevel === 3);
}

dom.clefTreble?.addEventListener("click", () => {
  setClef(CLEFS.treble);
  setFlow("key");
});
dom.clefBass?.addEventListener("click", () => {
  setClef(CLEFS.bass);
  setFlow("key");
});
dom.sigSharp?.addEventListener("click", () => {
  setKeySignature("sharp");
  setFlow("level");
});
dom.sigSharp2?.addEventListener("click", () => {
  setKeySignature("sharp2");
  setFlow("level");
});
dom.sigFlat?.addEventListener("click", () => {
  setKeySignature("flat");
  setFlow("level");
});
dom.sigFlat2?.addEventListener("click", () => {
  setKeySignature("flat2");
  setFlow("level");
});
dom.sigNatural?.addEventListener("click", () => {
  setKeySignature("natural");
  setFlow("level");
});
dom.level1?.addEventListener("click", () => {
  setLevel(1);
  setFlow("session");
  startSession();
});
dom.level2?.addEventListener("click", () => {
  setLevel(2);
  setFlow("session");
  startSession();
});
dom.level3?.addEventListener("click", () => {
  setLevel(3);
  setFlow("session");
  startSession();
});
dom.restart?.addEventListener("click", () => {
  setFlow("clef");
});
dom.redo?.addEventListener("click", () => {
  dom.endScreen?.classList.remove("show");
  setFlow("clef");
});
dom.micFallback?.addEventListener("click", startListening);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
setClef(CLEFS.treble);
setKeySignature("natural");
setLevel(1);
setFlow("clef");
startListening();
