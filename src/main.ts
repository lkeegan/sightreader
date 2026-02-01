import "./style.css";
import confetti from "canvas-confetti";
import { PitchDetector } from "pitchy";
import {
  DEFAULT_SESSION_NOTES,
  adjustNoteForKeyChange,
  buildNotePoolForLevel,
  frequencyToNote,
  notesMatchByMidi,
  noteNameToMidi,
  noteNameToStaffIndex,
} from "./note-utils";
import { AUDIO_CONFIG, CLEF_STYLE, CLEFS, KEY_SIGNATURE_POSITIONS, STAFF_DEFAULT } from "./config";
import { createStaffRenderer } from "./staff-renderer";
import { recordCorrectNote } from "./session-state";
import type { KeySignatureKey, Note } from "./note-utils";

const dom = {
  canvas: document.getElementById("staff") as HTMLCanvasElement,
  stage: document.querySelector(".stage") as HTMLElement | null,
  controls: document.querySelector(".controls") as HTMLElement | null,
  header: document.getElementById("flow-header") as HTMLElement | null,
  clefTreble: document.getElementById("clef-treble") as HTMLButtonElement | null,
  clefBass: document.getElementById("clef-bass") as HTMLButtonElement | null,
  sigSharp: document.getElementById("sig-sharp") as HTMLButtonElement | null,
  sigSharp2: document.getElementById("sig-sharp-2") as HTMLButtonElement | null,
  sigFlat: document.getElementById("sig-flat") as HTMLButtonElement | null,
  sigFlat2: document.getElementById("sig-flat-2") as HTMLButtonElement | null,
  sigNatural: document.getElementById("sig-natural") as HTMLButtonElement | null,
  level1: document.getElementById("level-1") as HTMLButtonElement | null,
  level2: document.getElementById("level-2") as HTMLButtonElement | null,
  level3: document.getElementById("level-3") as HTMLButtonElement | null,
  level4: document.getElementById("level-4") as HTMLButtonElement | null,
  status: document.getElementById("status") as HTMLElement | null,
  celebration: document.getElementById("celebration") as HTMLElement | null,
  micFallback: document.getElementById("mic-fallback") as HTMLButtonElement | null,
  confettiCanvas: document.getElementById("confetti-canvas") as HTMLCanvasElement | null,
  endScreen: document.getElementById("end-screen") as HTMLElement | null,
  redo: document.getElementById("redo-session") as HTMLButtonElement | null,
  restart: document.getElementById("restart-flow") as HTMLButtonElement | null,
  sessionBar: document.getElementById("session-bar") as HTMLElement | null,
  progressLabel: document.getElementById("progress-label") as HTMLElement | null,
  progressFill: document.getElementById("progress-fill") as HTMLElement | null,
  stepClef: document.querySelector(".clef-step") as HTMLElement | null,
  stepKey: document.querySelector(".key-step") as HTMLElement | null,
  stepLevel: document.querySelector(".level-step") as HTMLElement | null,
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

const setPressed = (button: HTMLButtonElement | null, isPressed: boolean) => {
  if (!button) return;
  button.classList.toggle("active", isPressed);
  button.setAttribute("aria-pressed", String(isPressed));
};

const setHidden = (element: HTMLElement | null, hidden: boolean) => {
  if (!element) return;
  element.classList.toggle("hidden", hidden);
};

let currentClef = CLEFS.treble;
let notePool: Note[] = [];

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeData: Float32Array<ArrayBuffer> | null = null;
let detector: ReturnType<typeof PitchDetector.forFloat32Array> | null = null;
const recentPitches: number[] = [];
const PITCH_WINDOW = 5;
let targetNote: Note | null = null;
let detectedNote: Note | null = null;
let detectedFrequency: number | null = null;
let listening = false;
let pendingNote: Note | null = null;
let pendingSince = 0;
let celebrationUntil = 0;
let nextNoteAt = 0;
let matchLock = false;
let nextNoteTimer: ReturnType<typeof setTimeout> | null = null;
let inputLocked = false;
let flyAway: {
  start: number;
  duration: number;
  dx: number;
  dy: number;
  loops: number;
  loopRadius: number;
  phase: number;
} | null = null;
let keySignature: KeySignatureKey = "natural";
let correctCount = 0;
let incorrectCount = 0;
let lastWrongMidi: number | null = null;
let lastWrongAt = 0;
const WRONG_COOLDOWN_MS = 350;
let currentLevel = 1;
let notesCompleted = 0;
const NOTES_PER_SESSION = SESSION.notesPerSession;
const isStandalonePwa =
  window.matchMedia?.("(display-mode: standalone)")?.matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone;

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
  flyAway = null;
  drawStaff();
}

function drawStaff() {
  const isMatch = notesMatchByMidi(detectedNote, targetNote, keySignature);
  const flyOffset = isMatch ? getFlyAwayOffset() : null;
  renderer.draw({
    clef: currentClef,
    keySignature,
    targetNote,
    detectedNote,
    isMatch,
    jitter: isMatch ? getCelebrationJitter() : null,
    targetOffset: flyOffset,
  });
}

function setKeySignature(nextSignature: KeySignatureKey) {
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
  if (dom.celebration) {
    dom.celebration.textContent = "Well done!";
    dom.celebration.classList.add("show");
  }
  startFlyAway();

  correctCount += 1;
  const nextState = recordCorrectNote({ notesCompleted, matchLock, inputLocked }, NOTES_PER_SESSION);
  notesCompleted = nextState.notesCompleted;
  matchLock = nextState.matchLock;
  inputLocked = nextState.inputLocked;
  updateProgress();
  incorrectCount = 0;
  lastWrongMidi = null;
  lastWrongAt = 0;
  if (nextState.shouldEnd) {
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
  const redoButton = dom.redo;
  if (redoButton) {
    redoButton.classList.remove("show");
    setTimeout(() => {
      redoButton.classList.add("show");
    }, SESSION.confettiMs);
  }
}

function startSession() {
  notesCompleted = 0;
  correctCount = 0;
  incorrectCount = 0;
  matchLock = false;
  inputLocked = false;
  flyAway = null;
  notePool = buildNotePool();
  updateProgress();
  pickRandomNote();
}

function updateProgress() {
  if (!dom.progressLabel || !dom.progressFill) return;
  dom.progressLabel.textContent = `${notesCompleted} / ${NOTES_PER_SESSION}`;
  dom.progressFill.style.width = `${(notesCompleted / NOTES_PER_SESSION) * 100}%`;
}

function startFlyAway() {
  if (!targetNote) return;
  const angle = Math.random() * Math.PI * 2;
  const distance = 180 + Math.random() * 120;
  const loops = 1 + Math.floor(Math.random() * 2);
  const loopRadius = 18 + Math.random() * 12;
  flyAway = {
    start: performance.now(),
    duration: Math.max(600, SESSION.nextNoteDelayMs * 0.9),
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
    loops,
    loopRadius,
    phase: Math.random() * Math.PI * 2,
  };
}

function getFlyAwayOffset() {
  if (!flyAway) return null;
  const now = performance.now();
  const elapsed = now - flyAway.start;
  const tRaw = Math.min(Math.max(elapsed / flyAway.duration, 0), 1);
  const t = tRaw * tRaw;
  const loopAngle = tRaw * flyAway.loops * Math.PI * 2 + flyAway.phase;
  const offset = {
    x: flyAway.dx * t + Math.sin(loopAngle) * flyAway.loopRadius,
    y: flyAway.dy * t + Math.cos(loopAngle) * flyAway.loopRadius,
  };
  const scale = 1 + t * 0.6;
  const alpha = 1 - tRaw * tRaw;
  return { offset, scale, alpha };
}

function setFlow(step: "clef" | "key" | "level" | "session") {
  dom.stepClef?.classList.toggle("active", step === "clef");
  dom.stepKey?.classList.toggle("active", step === "key");
  dom.stepLevel?.classList.toggle("active", step === "level");
  const inSession = step === "session";
  setHidden(dom.stage, !inSession);
  setHidden(dom.sessionBar, !inSession);
  setHidden(dom.status, !inSession);
  setHidden(dom.micFallback, !inSession || listening);
  setHidden(dom.controls, inSession);
  dom.controls?.classList.toggle("clef-only", step !== "session");
  setHidden(dom.header, inSession && listening);
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
    const AudioCtor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      throw new Error("AudioContext not supported");
    }
    audioContext = new AudioCtor();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = AUDIO.fftSize;
    analyser.smoothingTimeConstant = AUDIO.smoothing;
    source.connect(analyser);
    timeData = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
    detector = PitchDetector.forFloat32Array(analyser.fftSize);
    listening = true;
    if (dom.status) {
      dom.status.textContent = "Listening…";
    }
    dom.micFallback?.classList.add("hidden");
    tick();
  } catch (error) {
    if (dom.status) {
      dom.status.textContent = "Tap to enable microphone";
    }
    dom.micFallback?.classList.remove("hidden");
  }
}

function detectPitch() {
  if (!analyser || !timeData || !audioContext || !detector) return;
  analyser.getFloatTimeDomainData(timeData);
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const sample = timeData[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);

  const [pitch, detectedClarity] = detector.findPitch(timeData, audioContext.sampleRate);
  if (
    !pitch ||
    detectedClarity < AUDIO.clarityThreshold ||
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
    dom.celebration?.classList.remove("show");
  }
  if (matchLock && now > nextNoteAt) {
    matchLock = false;
    celebrationUntil = 0;
  }

  drawStaff();

  if (!matchLock && detectedNote && targetNote) {
    if (notesMatchByMidi(detectedNote, targetNote, keySignature)) {
      triggerCelebration();
    } else {
      const midi =
        typeof detectedNote.midi === "number" ? detectedNote.midi : noteNameToMidi(detectedNote.name);
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

function setClef(nextClef: typeof CLEFS.treble) {
  currentClef = nextClef;
  setPressed(dom.clefTreble, currentClef === CLEFS.treble);
  setPressed(dom.clefBass, currentClef === CLEFS.bass);
}

function setLevel(nextLevel: number) {
  currentLevel = nextLevel;
  setPressed(dom.level1, currentLevel === 1);
  setPressed(dom.level2, currentLevel === 2);
  setPressed(dom.level3, currentLevel === 3);
  setPressed(dom.level4, currentLevel === 4);
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
dom.level4?.addEventListener("click", () => {
  setLevel(4);
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
if (isStandalonePwa) {
  if (dom.status) {
    dom.status.textContent = "Tap to enable microphone";
  }
  dom.micFallback?.classList.remove("hidden");
} else {
  startListening();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`);
  });
}
