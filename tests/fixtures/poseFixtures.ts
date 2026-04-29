/**
 * Synthetic pose data generators for testing.
 * Creates PoseFrame arrays that simulate specific lift scenarios
 * without requiring real video files.
 *
 * Coordinate system: normalized [0,1], Y increases downward (MediaPipe convention).
 * A "standing" person has hips around y=0.55, knees around y=0.72, shoulders at y=0.35.
 */

import type { PoseFrame, Keypoint } from "../../src/lib/core/types";

function kp(x: number, y: number, visibility = 0.95): Keypoint {
  return { x, y, z: 0, visibility, name: "" };
}

/** Interpolate between two values */
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface SquatPose {
  hipY: number;
  kneeY: number;
  shoulderY: number;
  ankleY: number;
  kneeX: number;
  shoulderX: number;
  hipX: number;
}

function buildFrame(pose: SquatPose, timestampMs: number, frameIndex: number): PoseFrame {
  const { hipY, kneeY, shoulderY, ankleY, kneeX, shoulderX, hipX } = pose;

  // Side-view camera: near side (left) fully visible, far side (right) partially occluded.
  // This asymmetry is what estimateSideViewConfidence detects.
  return {
    timestamp: timestampMs,
    frameIndex,
    confidence: 0.9,
    keypoints: {
      nose: kp(shoulderX, shoulderY - 0.15),
      left_shoulder: kp(shoulderX - 0.04, shoulderY, 0.95),
      right_shoulder: kp(shoulderX + 0.04, shoulderY, 0.55),  // far side, lower visibility
      left_elbow: kp(shoulderX - 0.08, shoulderY + 0.1),
      right_elbow: kp(shoulderX + 0.08, shoulderY + 0.1, 0.50),
      left_wrist: kp(shoulderX - 0.06, shoulderY + 0.05),
      right_wrist: kp(shoulderX + 0.06, shoulderY + 0.05, 0.45),
      left_hip: kp(hipX - 0.03, hipY, 0.95),
      right_hip: kp(hipX + 0.03, hipY, 0.65),  // far hip, lower visibility
      left_knee: kp(kneeX - 0.03, kneeY, 0.95),
      right_knee: kp(kneeX + 0.03, kneeY, 0.60),
      left_ankle: kp(kneeX - 0.02, ankleY),
      right_ankle: kp(kneeX + 0.02, ankleY, 0.70),
      left_heel: kp(kneeX - 0.04, ankleY + 0.02),
      right_heel: kp(kneeX + 0.04, ankleY + 0.02, 0.65),
      left_foot_index: kp(kneeX - 0.01, ankleY + 0.04),
      right_foot_index: kp(kneeX + 0.01, ankleY + 0.04, 0.65),
      left_ear: kp(shoulderX - 0.06, shoulderY - 0.1, 0.85),
      right_ear: kp(shoulderX + 0.06, shoulderY - 0.1, 0.20),  // far ear, mostly occluded
    },
  };
}

/** Standing pose (start/end of rep) */
const STANDING: SquatPose = {
  hipY: 0.55, kneeY: 0.72, shoulderY: 0.35,
  ankleY: 0.88, kneeX: 0.5, shoulderX: 0.5, hipX: 0.5,
};

/** Deep squat — hip crease below knee (passes depth check) */
const DEEP_SQUAT: SquatPose = {
  hipY: 0.76, kneeY: 0.73, shoulderY: 0.50,
  ankleY: 0.88, kneeX: 0.48, shoulderX: 0.50, hipX: 0.50,
};

/** Shallow squat — hip crease above knee (fails depth check) */
const SHALLOW_SQUAT: SquatPose = {
  hipY: 0.68, kneeY: 0.73, shoulderY: 0.43,
  ankleY: 0.88, kneeX: 0.48, shoulderX: 0.50, hipX: 0.50,
};

/** Forward knee drift — knee keeps moving forward past mid-descent */
const KNEE_DRIFT_SQUAT: SquatPose = {
  hipY: 0.74, kneeY: 0.73, shoulderY: 0.48,
  ankleY: 0.88, kneeX: 0.58, shoulderX: 0.50, hipX: 0.50,
};

const FRAMES_PER_REP = 45;
const MS_PER_FRAME = 66; // ~15fps

function generateRepFrames(
  startIndex: number,
  startTimestamp: number,
  bottomPose: SquatPose,
  options: { kneeForwardDrift?: boolean } = {}
): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const totalFrames = FRAMES_PER_REP;
  const descentFrames = Math.floor(totalFrames * 0.45);
  const bottomFrames = 3; // small dwell
  const ascentFrames = totalFrames - descentFrames - bottomFrames;

  for (let i = 0; i < totalFrames; i++) {
    const frameIndex = startIndex + i;
    const ts = startTimestamp + i * MS_PER_FRAME;

    let pose: SquatPose;

    if (i < descentFrames) {
      // Descent: standing → bottom
      const t = i / descentFrames;
      const kneeDriftExtra = options.kneeForwardDrift
        ? t * 0.1 // knee keeps drifting throughout descent
        : (t < 0.5 ? t * 0.08 : 0.04); // knee moves in first half then stops

      pose = {
        hipY: lerp(STANDING.hipY, bottomPose.hipY, t),
        kneeY: lerp(STANDING.kneeY, bottomPose.kneeY, t),
        shoulderY: lerp(STANDING.shoulderY, bottomPose.shoulderY, t),
        ankleY: STANDING.ankleY,
        kneeX: STANDING.kneeX + kneeDriftExtra,
        shoulderX: STANDING.shoulderX,
        hipX: STANDING.hipX,
      };
    } else if (i < descentFrames + bottomFrames) {
      // Bottom dwell
      pose = { ...bottomPose };
    } else {
      // Ascent: bottom → standing
      const t = (i - descentFrames - bottomFrames) / ascentFrames;
      pose = {
        hipY: lerp(bottomPose.hipY, STANDING.hipY, t),
        kneeY: lerp(bottomPose.kneeY, STANDING.kneeY, t),
        shoulderY: lerp(bottomPose.shoulderY, STANDING.shoulderY, t),
        ankleY: STANDING.ankleY,
        kneeX: lerp(bottomPose.kneeX, STANDING.kneeX, t),
        shoulderX: STANDING.shoulderX,
        hipX: STANDING.hipX,
      };
    }

    frames.push(buildFrame(pose, ts, frameIndex));
  }

  return frames;
}

/** 2 seconds of standing before the first rep (simulates walkout) */
function generateStandingFrames(count: number, startTimestamp: number): PoseFrame[] {
  return Array.from({ length: count }, (_, i) =>
    buildFrame(STANDING, startTimestamp + i * MS_PER_FRAME, i)
  );
}

export function generateGoodSquatVideo(): PoseFrame[] {
  const walkout = generateStandingFrames(20, 0);
  const rep1 = generateRepFrames(20, walkout.length * MS_PER_FRAME, DEEP_SQUAT);
  const pause = generateStandingFrames(10, (walkout.length + rep1.length) * MS_PER_FRAME);
  const rep2 = generateRepFrames(
    walkout.length + rep1.length + pause.length,
    (walkout.length + rep1.length + pause.length) * MS_PER_FRAME,
    DEEP_SQUAT
  );
  return [...walkout, ...rep1, ...pause, ...rep2];
}

export function generateShallowSquatVideo(): PoseFrame[] {
  const walkout = generateStandingFrames(20, 0);
  const rep1 = generateRepFrames(20, walkout.length * MS_PER_FRAME, SHALLOW_SQUAT);
  const pause = generateStandingFrames(10, (walkout.length + rep1.length) * MS_PER_FRAME);
  const rep2 = generateRepFrames(
    walkout.length + rep1.length + pause.length,
    (walkout.length + rep1.length + pause.length) * MS_PER_FRAME,
    SHALLOW_SQUAT
  );
  return [...walkout, ...rep1, ...pause, ...rep2];
}

export function generateForwardKneeDriftVideo(): PoseFrame[] {
  const walkout = generateStandingFrames(20, 0);
  const rep1 = generateRepFrames(20, walkout.length * MS_PER_FRAME, KNEE_DRIFT_SQUAT, {
    kneeForwardDrift: true,
  });
  return [...walkout, ...rep1];
}

// ─── Deadlift fixtures ────────────────────────────────────────────────────────

/**
 * Deadlift frame: lifter faces right (foot_index.x > heel.x so facingSign returns +1).
 * Signal: invertedWristYSignal = -wristY. The "bar on floor" position has high wristY
 * (wrist near ankles) which becomes the low-signal "standing" baseline for the FSM.
 */
function buildDeadliftFrame(
  shoulderY: number,
  hipY: number,
  wristY: number,
  lean: number, // shoulder X offset from hip (backward lean > 0)
  timestampMs: number,
  frameIndex: number,
): PoseFrame {
  const hipX = 0.5;
  const shoulderX = hipX - lean; // positive lean = shoulders behind hips
  return {
    timestamp: timestampMs,
    frameIndex,
    confidence: 0.9,
    keypoints: {
      nose: kp(shoulderX - 0.05, shoulderY - 0.15),
      left_shoulder: kp(shoulderX - 0.02, shoulderY),
      right_shoulder: kp(shoulderX + 0.02, shoulderY, 0.6),
      left_hip: kp(hipX - 0.02, hipY),
      right_hip: kp(hipX + 0.02, hipY, 0.7),
      left_knee: kp(hipX - 0.02, hipY + 0.17),
      right_knee: kp(hipX + 0.02, hipY + 0.17, 0.7),
      left_ankle: kp(hipX, hipY + 0.32),
      right_ankle: kp(hipX, hipY + 0.32, 0.7),
      // Wrists centered at ankle X so bar drift reads near zero
      left_wrist: kp(hipX, wristY),
      right_wrist: kp(hipX, wristY, 0.7),
      left_elbow: kp(hipX, (shoulderY + wristY) / 2),
      right_elbow: kp(hipX + 0.02, (shoulderY + wristY) / 2, 0.6),
      // Facing right: foot_index.x > heel.x
      left_heel: kp(hipX - 0.05, hipY + 0.34),
      right_heel: kp(hipX + 0.05, hipY + 0.34, 0.7),
      left_foot_index: kp(hipX + 0.05, hipY + 0.36),
      right_foot_index: kp(hipX + 0.08, hipY + 0.36, 0.7),
      left_ear: kp(shoulderX - 0.04, shoulderY - 0.12, 0.8),
      right_ear: kp(shoulderX + 0.04, shoulderY - 0.12, 0.3),
    },
  };
}

function generateDeadliftRep(startIndex: number, startTs: number): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const total = FRAMES_PER_REP;
  // Phase 1: setup hinge (bar to floor) — wristY rises from 0.60 to 0.85
  // Phase 2: pull (bar rises) — wristY falls from 0.85 to 0.55 (lockout)
  // Phase 3: lower (bar back to floor) — wristY rises from 0.55 to 0.85
  const setupEnd = Math.floor(total * 0.25);
  const lockoutEnd = Math.floor(total * 0.6);

  for (let i = 0; i < total; i++) {
    const ts = startTs + i * MS_PER_FRAME;
    let shoulderY: number, hipY: number, wristY: number;
    if (i < setupEnd) {
      const t = i / setupEnd;
      wristY = lerp(0.60, 0.85, t);
      shoulderY = lerp(0.35, 0.48, t);
      hipY = lerp(0.55, 0.62, t);
    } else if (i < lockoutEnd) {
      const t = (i - setupEnd) / (lockoutEnd - setupEnd);
      wristY = lerp(0.85, 0.55, t);
      shoulderY = lerp(0.48, 0.35, t);
      hipY = lerp(0.62, 0.55, t);
    } else {
      const t = (i - lockoutEnd) / (total - lockoutEnd);
      wristY = lerp(0.55, 0.85, t);
      shoulderY = lerp(0.35, 0.48, t);
      hipY = lerp(0.55, 0.62, t);
    }
    frames.push(buildDeadliftFrame(shoulderY, hipY, wristY, 0.01, ts, startIndex + i));
  }
  return frames;
}

/** Clean conventional deadlift — no hitch, no bar drift, no hyperextension. */
export function generateGoodDeadliftVideo(): PoseFrame[] {
  const pre = generateStandingFrames(20, 0);
  const rep1 = generateDeadliftRep(20, pre.length * MS_PER_FRAME);
  const between = generateStandingFrames(10, (pre.length + rep1.length) * MS_PER_FRAME);
  const rep2 = generateDeadliftRep(
    pre.length + rep1.length + between.length,
    (pre.length + rep1.length + between.length) * MS_PER_FRAME,
  );
  return [...pre, ...rep1, ...between, ...rep2];
}

// ─── Bench press fixtures ─────────────────────────────────────────────────────

/**
 * Bench press frame: lifter is supine. Shoulder and hip share nearly the same Y
 * (both resting on the bench), satisfying isSupine(). Wrist descends to chest
 * and returns for the press signal.
 */
function buildBenchFrame(
  wristY: number,
  elbowAngleDeg: number, // ~180 at lockout, ~70 at chest
  timestampMs: number,
  frameIndex: number,
): PoseFrame {
  // Supine: shoulder and hip at same Y; body horizontal across the frame
  const shoulderX = 0.45;
  const shoulderY = 0.50;
  const hipX = 0.65;
  const hipY = 0.50;
  const elbowY = shoulderY - 0.05;
  const wristX = shoulderX - 0.02;

  return {
    timestamp: timestampMs,
    frameIndex,
    confidence: 0.9,
    keypoints: {
      nose: kp(shoulderX - 0.15, shoulderY),
      left_shoulder: kp(shoulderX - 0.02, shoulderY),
      right_shoulder: kp(shoulderX + 0.02, shoulderY, 0.6),
      left_elbow: kp(wristX - 0.04, elbowY),
      right_elbow: kp(wristX + 0.04, elbowY, 0.6),
      left_wrist: kp(wristX - 0.02, wristY),
      right_wrist: kp(wristX + 0.02, wristY, 0.6),
      left_hip: kp(hipX - 0.02, hipY),
      right_hip: kp(hipX + 0.02, hipY, 0.7),
      left_knee: kp(hipX + 0.12, hipY + 0.05),
      right_knee: kp(hipX + 0.12, hipY + 0.05, 0.7),
      left_ankle: kp(hipX + 0.22, hipY + 0.08),
      right_ankle: kp(hipX + 0.22, hipY + 0.08, 0.7),
      left_heel: kp(hipX + 0.24, hipY + 0.09),
      right_heel: kp(hipX + 0.24, hipY + 0.09, 0.7),
      left_foot_index: kp(hipX + 0.20, hipY + 0.10),
      right_foot_index: kp(hipX + 0.20, hipY + 0.10, 0.7),
      left_ear: kp(shoulderX - 0.18, shoulderY - 0.02, 0.8),
      right_ear: kp(shoulderX - 0.14, shoulderY + 0.02, 0.3),
    },
  };
}

function generateBenchRepFrames(startIndex: number, startTs: number, pauseMs: number): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const total = FRAMES_PER_REP;
  const descentEnd = Math.floor(total * 0.35);
  const chestFrames = Math.max(1, Math.round(pauseMs / MS_PER_FRAME));
  const ascentStart = descentEnd + chestFrames;

  for (let i = 0; i < total + chestFrames; i++) {
    const ts = startTs + i * MS_PER_FRAME;
    let wristY: number;
    if (i < descentEnd) {
      wristY = lerp(0.42, 0.55, i / descentEnd);
    } else if (i < ascentStart) {
      wristY = 0.55;
    } else {
      const t = (i - ascentStart) / (total - descentEnd);
      wristY = lerp(0.55, 0.42, Math.min(1, t));
    }
    frames.push(buildBenchFrame(wristY, i < ascentStart ? 80 : 160, ts, startIndex + i));
  }
  return frames;
}

/** Clean bench press with a solid pause (600ms). */
export function generateGoodBenchVideo(): PoseFrame[] {
  const pre = Array.from({ length: 20 }, (_, i) =>
    buildBenchFrame(0.42, 175, i * MS_PER_FRAME, i)
  );
  const rep1 = generateBenchRepFrames(20, pre.length * MS_PER_FRAME, 600);
  const between = Array.from({ length: 10 }, (_, i) =>
    buildBenchFrame(0.42, 175, (pre.length + rep1.length + i) * MS_PER_FRAME, pre.length + rep1.length + i)
  );
  const rep2 = generateBenchRepFrames(
    pre.length + rep1.length + between.length,
    (pre.length + rep1.length + between.length) * MS_PER_FRAME,
    600,
  );
  return [...pre, ...rep1, ...between, ...rep2];
}

/** Bench press with a bounce (no pause, <100ms at chest). */
export function generateBounceBenchVideo(): PoseFrame[] {
  const pre = Array.from({ length: 20 }, (_, i) =>
    buildBenchFrame(0.42, 175, i * MS_PER_FRAME, i)
  );
  const rep1 = generateBenchRepFrames(20, pre.length * MS_PER_FRAME, 0);
  return [...pre, ...rep1];
}

// ─── Romanian deadlift fixtures ───────────────────────────────────────────────

/**
 * RDL frame: lifter faces right. Hips hinge back and down while knees stay
 * nearly constant (the defining feature of the RDL vs squat pattern).
 */
function buildRdlFrame(
  hipY: number,
  shoulderY: number,
  shoulderXOffset: number, // forward offset from hipX; >0 = forward (facing right = +X)
  timestampMs: number,
  frameIndex: number,
): PoseFrame {
  const hipX = 0.5;
  const kneeX = 0.5;
  const kneeY = 0.72;
  const ankleY = 0.88;
  const shoulderX = hipX + shoulderXOffset;

  return {
    timestamp: timestampMs,
    frameIndex,
    confidence: 0.9,
    keypoints: {
      nose: kp(shoulderX + 0.04, shoulderY - 0.14),
      left_shoulder: kp(shoulderX - 0.02, shoulderY - 0.02),
      right_shoulder: kp(shoulderX + 0.02, shoulderY + 0.02, 0.6),
      left_hip: kp(hipX - 0.02, hipY),
      right_hip: kp(hipX + 0.02, hipY, 0.7),
      left_knee: kp(kneeX - 0.02, kneeY),
      right_knee: kp(kneeX + 0.02, kneeY, 0.7),
      left_ankle: kp(kneeX - 0.02, ankleY),
      right_ankle: kp(kneeX + 0.02, ankleY, 0.7),
      left_wrist: kp(hipX - 0.02, hipY + 0.08),
      right_wrist: kp(hipX + 0.02, hipY + 0.08, 0.7),
      left_elbow: kp(hipX - 0.02, hipY - 0.04),
      right_elbow: kp(hipX + 0.02, hipY - 0.04, 0.6),
      left_heel: kp(kneeX - 0.05, ankleY + 0.01),
      right_heel: kp(kneeX + 0.05, ankleY + 0.01, 0.7),
      left_foot_index: kp(kneeX + 0.05, ankleY + 0.02),
      right_foot_index: kp(kneeX + 0.08, ankleY + 0.02, 0.7),
      left_ear: kp(shoulderX - 0.02, shoulderY - 0.10, 0.8),
      right_ear: kp(shoulderX + 0.02, shoulderY - 0.10, 0.3),
    },
  };
}

function generateRdlRepFrames(startIndex: number, startTs: number): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const total = FRAMES_PER_REP;
  const hingeEnd = Math.floor(total * 0.45);
  const bottomFrames = 3;
  const returnStart = hingeEnd + bottomFrames;

  for (let i = 0; i < total; i++) {
    const ts = startTs + i * MS_PER_FRAME;
    let hipY: number, shoulderY: number, shoulderXOffset: number;
    if (i < hingeEnd) {
      const t = i / hingeEnd;
      hipY = lerp(0.55, 0.67, t);
      shoulderY = lerp(0.35, 0.55, t);
      // Torso tips forward (shoulders move ahead of hips in facing direction)
      shoulderXOffset = lerp(0.02, 0.18, t);
    } else if (i < returnStart) {
      hipY = 0.67;
      shoulderY = 0.55;
      shoulderXOffset = 0.18;
    } else {
      const t = (i - returnStart) / (total - returnStart);
      hipY = lerp(0.67, 0.55, t);
      shoulderY = lerp(0.55, 0.35, t);
      // Shoulders return to slightly forward of hips at lockout (no backward lean)
      shoulderXOffset = lerp(0.18, 0.02, t);
    }
    frames.push(buildRdlFrame(hipY, shoulderY, shoulderXOffset, ts, startIndex + i));
  }
  return frames;
}

/** Clean RDL — constant knees, bar close to legs, no hyperextension. */
export function generateGoodRdlVideo(): PoseFrame[] {
  const pre = Array.from({ length: 20 }, (_, i) =>
    buildRdlFrame(0.55, 0.35, 0.02, i * MS_PER_FRAME, i)
  );
  const rep1 = generateRdlRepFrames(20, pre.length * MS_PER_FRAME);
  const between = Array.from({ length: 10 }, (_, i) =>
    buildRdlFrame(0.55, 0.35, 0.02, (pre.length + rep1.length + i) * MS_PER_FRAME, pre.length + rep1.length + i)
  );
  const rep2 = generateRdlRepFrames(
    pre.length + rep1.length + between.length,
    (pre.length + rep1.length + between.length) * MS_PER_FRAME,
  );
  return [...pre, ...rep1, ...between, ...rep2];
}
