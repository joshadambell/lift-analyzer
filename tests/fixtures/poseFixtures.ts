/**
 * Synthetic pose data generators for testing.
 * Creates PoseFrame arrays that simulate specific squat scenarios
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
