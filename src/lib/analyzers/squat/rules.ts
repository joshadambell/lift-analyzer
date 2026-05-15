/**
 * Squat form rules — geometric detectors with KB-sourced cue language.
 *
 * Numeric thresholds live here as tuning parameters. Coaching language
 * (passed/borderline/failed cues) is drawn from src/lib/knowledge/lifts.json
 * via the `kbCues` map below — to update wording, edit the KB, not the code.
 */

import type { PoseFrame, RuleResult, RuleVerdict } from "../../core/types";
import type { RepBounds } from "../../core/repSegmenter";
import {
  getKp,
  dominantSide,
  midpoint,
  angleDeg,
  smoothMovingAverage,
  mean,
  distance,
} from "../../core/geometry";
import { getFault } from "../../knowledge";
import { type CueSet, unknownResult, finalize } from "../../core/ruleHelpers";

// ─── KB-sourced cue builders ──────────────────────────────────────────────────

/** Build a cue triple from a KB fault entry. */
function cuesFromFault(faultId: string, passedCue: string, borderlineSuffix?: string): CueSet {
  const f = getFault("squat", faultId);
  if (!f) {
    return {
      passed: passedCue,
      borderline: passedCue,
      failed: "Form fault detected.",
    };
  }
  const corrections = f.correction.map((c) => c.replace(/_/g, " ")).join("; ");
  return {
    passed: passedCue,
    borderline: borderlineSuffix
      ? `${borderlineSuffix} ${corrections.split(";")[0]}.`
      : `Borderline ${f.fault.toLowerCase()}.`,
    failed: `${f.description}. Fix: ${corrections}.`,
  };
}

// ─── Rule configs (numeric thresholds + cue references) ───────────────────────

export const SQUAT_RULE_CONFIGS = {
  depth: {
    id: "depth",
    name: "Depth",
    toleranceFraction: 0.02,
    cues: cuesFromFault(
      "sq_fault_4",
      "Hip crease at or below patella — depth standard met.",
      "Just at parallel — descend an inch deeper to bank it."
    ),
  },
  kneeTravel: {
    id: "kneeTravel",
    name: "Knee tracking",
    driftFractionThreshold: 0.02,
    cues: cuesFromFault(
      "sq_fault_1",
      "Knees tracked over toes throughout.",
      "Slight inward knee travel."
    ),
  },
  hipShoot: {
    id: "hipShoot",
    name: "Hip/chest rise ratio",
    maxRatioDivergence: 0.15,
    cues: cuesFromFault(
      "sq_fault_2",
      "Hips and shoulders rose together.",
      "Slight hip lead on the way up."
    ),
  },
  barPath: {
    id: "barPath",
    name: "Bar path",
    maxDriftFraction: 0.05,
    cues: cuesFromFault(
      "sq_fault_5",
      "Bar tracked vertically over midfoot.",
      "Minor bar path drift — watch forward lean."
    ),
  },
  tempo: {
    id: "tempo",
    name: "Bottom dwell",
    maxBottomDwellMs: 500,
    cues: {
      passed: "Tight reversal at the bottom.",
      borderline: "Slight pause at the bottom — try to reverse immediately.",
      failed:
        "Long pause at the bottom. For non-paused squats, descend with control and reverse immediately to use the stretch reflex.",
    } satisfies CueSet,
  },
  heelLift: {
    id: "heelLift",
    name: "Heel position",
    maxAnkleFlexChange: 20,
    cues: {
      passed: "Heels stayed planted through the descent.",
      borderline: "Minor heel movement — verify with front-view footage.",
      failed:
        "Heel lift detected. Address ankle mobility (dorsiflexion 20–40° ideal) or use heel-elevated shoes while training mobility.",
    } satisfies CueSet,
  },
  headPosition: {
    id: "headPosition",
    name: "Head/neck alignment",
    maxDeviationDeg: 35,
    cues: {
      passed: "Head neutral — good cervical alignment.",
      borderline: "Slight head deviation — keep gaze steady.",
      failed:
        "Extreme head position. Eyes forward or slightly down, no chin jut, no neck hyperextension.",
    } satisfies CueSet,
  },
  buttWink: {
    id: "buttWink",
    name: "Lower back rounding (butt wink)",
    minConfidenceToFlag: 0.85,
    hipShoulderAngleThreshold: 15,
    cues: cuesFromFault(
      "sq_fault_3",
      "Lumbar appears neutral at the bottom."
    ),
    unknownCue:
      "Cannot reliably assess lower back rounding from this camera angle — requires high-confidence keypoint visibility.",
  },
} as const;

// ─── Rule check functions ─────────────────────────────────────────────────────

export function checkDepth(
  frames: PoseFrame[],
  bounds: RepBounds,
  _repNumber: number,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.depth;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.cues.failed);

  const hip = dominantSide(bottomFrame, "left_hip", "right_hip");
  const knee = dominantSide(bottomFrame, "left_knee", "right_knee");
  if (!hip || !knee || hip.visibility < 0.5 || knee.visibility < 0.5) {
    return unknownResult(cfg.id, cfg.name, cfg.cues.failed);
  }

  const ankle = dominantSide(bottomFrame, "left_ankle", "right_ankle");
  const shinLen = ankle ? distance(knee, ankle) : distance(hip, knee) * 0.8;

  // IPF standard: top surface of thigh at hip joint must be below the top of
  // the kneecap. MediaPipe's hip landmark (greater trochanter) is at the right
  // height for the hip reference. The knee landmark is the joint center, which
  // sits below the patella top — adjust upward by ~12% of shin length.
  const patellaTopY = knee.y - 0.12 * shinLen;

  const tolerance = torsoLen * cfg.toleranceFraction;
  const hipBelowPatellaTopBy = hip.y - patellaTopY;
  const conf = Math.min(hip.visibility, knee.visibility);

  let verdict: RuleVerdict;
  if (hipBelowPatellaTopBy > tolerance) verdict = "passed";
  else if (hipBelowPatellaTopBy > -tolerance) verdict = "borderline";
  else verdict = "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, hipBelowPatellaTopBy, tolerance, conf, bottomFrame.timestamp);
}

export function checkKneeTravel(
  frames: PoseFrame[],
  bounds: RepBounds,
  _repNumber: number,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.kneeTravel;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  if (repFrames.length < 6) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const kneeX = repFrames.map((f) => {
    const k = dominantSide(f, "left_knee", "right_knee");
    return k ? k.x : null;
  });

  const midDescentIdx = Math.floor(repFrames.length / 2);
  const firstHalf = kneeX.slice(0, midDescentIdx).filter((v): v is number => v !== null);
  const secondHalf = kneeX.slice(midDescentIdx).filter((v): v is number => v !== null);

  if (!firstHalf.length || !secondHalf.length) {
    return unknownResult(cfg.id, cfg.name, cfg.cues.passed);
  }

  const peakFirstHalf = Math.max(...firstHalf);
  const peakSecondHalf = Math.max(...secondHalf);
  const continuedDrift = peakSecondHalf - peakFirstHalf;
  const driftThreshold = torsoLen * cfg.driftFractionThreshold;

  let verdict: RuleVerdict;
  if (continuedDrift <= 0) verdict = "passed";
  else if (continuedDrift < driftThreshold) verdict = "borderline";
  else verdict = "failed";

  const conf = mean(
    repFrames.map((f) => dominantSide(f, "left_knee", "right_knee")?.visibility ?? 0)
  );

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, continuedDrift, driftThreshold, conf);
}

export function checkHipShoot(
  frames: PoseFrame[],
  bounds: RepBounds,
  _repNumber: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.hipShoot;
  const ascentFrames = frames.slice(bounds.bottomFrame, bounds.endFrame + 1);
  if (ascentFrames.length < 4) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const hipY = ascentFrames.map((f) => {
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    return lh && rh ? midpoint(lh, rh).y : null;
  });
  const shoulderY = ascentFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    return ls && rs ? midpoint(ls, rs).y : null;
  });

  const hipDeltas: number[] = [];
  const shoulderDeltas: number[] = [];
  for (let i = 1; i < ascentFrames.length; i++) {
    const hd = hipY[i - 1] !== null && hipY[i] !== null ? (hipY[i - 1]! - hipY[i]!) : null;
    const sd = shoulderY[i - 1] !== null && shoulderY[i] !== null ? (shoulderY[i - 1]! - shoulderY[i]!) : null;
    if (hd !== null) hipDeltas.push(hd);
    if (sd !== null) shoulderDeltas.push(sd);
  }

  if (!hipDeltas.length || !shoulderDeltas.length) {
    return unknownResult(cfg.id, cfg.name, cfg.cues.passed);
  }

  const avgHipRate = mean(hipDeltas);
  const avgShoulderRate = mean(shoulderDeltas);

  const divergence = avgHipRate > 0 && avgShoulderRate > 0
    ? (avgHipRate - avgShoulderRate) / Math.max(avgHipRate, avgShoulderRate)
    : 0;

  let verdict: RuleVerdict;
  if (divergence < cfg.maxRatioDivergence / 2) verdict = "passed";
  else if (divergence < cfg.maxRatioDivergence) verdict = "borderline";
  else verdict = "failed";

  const conf = mean(ascentFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const lh = getKp(f, "left_hip");
    return ((ls?.visibility ?? 0) + (lh?.visibility ?? 0)) / 2;
  }));

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, divergence, cfg.maxRatioDivergence, conf);
}

export function checkBarPath(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.barPath;
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);

  const barX = repFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    if (ls && rs) return midpoint(ls, rs).x;
    if (ls) return ls.x;
    if (rs) return rs.x;
    return null;
  }).filter((v): v is number => v !== null);

  if (barX.length < 4) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const smoothedBarX = smoothMovingAverage(barX, 5);
  const drift = Math.max(...smoothedBarX) - Math.min(...smoothedBarX);
  const driftFraction = torsoLen > 0 ? drift / torsoLen : drift;

  let verdict: RuleVerdict;
  if (driftFraction <= cfg.maxDriftFraction / 2) verdict = "passed";
  else if (driftFraction <= cfg.maxDriftFraction) verdict = "borderline";
  else verdict = "failed";

  const conf = mean(repFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    return ((ls?.visibility ?? 0) + (rs?.visibility ?? 0)) / 2;
  }));

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, driftFraction * 100, cfg.maxDriftFraction * 100, conf);
}

export function checkTempo(bottomDwellMs: number): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.tempo;
  let verdict: RuleVerdict;
  if (bottomDwellMs <= cfg.maxBottomDwellMs / 2) verdict = "passed";
  else if (bottomDwellMs <= cfg.maxBottomDwellMs) verdict = "borderline";
  else verdict = "failed";
  return finalize(cfg.id, cfg.name, verdict, cfg.cues, bottomDwellMs, cfg.maxBottomDwellMs, 0.9);
}

export function checkHeelLift(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.heelLift;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);

  const ankleAngles = repFrames.map((f) => {
    const knee = dominantSide(f, "left_knee", "right_knee");
    const ankle = dominantSide(f, "left_ankle", "right_ankle");
    const heel = dominantSide(f, "left_heel", "right_heel");
    if (!knee || !ankle || !heel) return null;
    if (knee.visibility < 0.5 || ankle.visibility < 0.5 || heel.visibility < 0.5) return null;
    return angleDeg(knee, ankle, heel);
  }).filter((v): v is number => v !== null);

  if (ankleAngles.length < 4) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const firstAvg = mean(ankleAngles.slice(0, 3));
  const lastAvg = mean(ankleAngles.slice(-3));
  const change = Math.abs(lastAvg - firstAvg);

  let verdict: RuleVerdict;
  if (change <= cfg.maxAnkleFlexChange / 2) verdict = "passed";
  else if (change <= cfg.maxAnkleFlexChange) verdict = "borderline";
  else verdict = "failed";

  const conf = mean(repFrames.map((f) => {
    const ankle = dominantSide(f, "left_ankle", "right_ankle");
    return ankle?.visibility ?? 0;
  }));

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, change, cfg.maxAnkleFlexChange, conf);
}

export function checkHeadPosition(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.headPosition;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const nose = getKp(bottomFrame, "nose");
  const ls = getKp(bottomFrame, "left_shoulder");
  const rs = getKp(bottomFrame, "right_shoulder");
  if (!nose || !ls || !rs) return unknownResult(cfg.id, cfg.name, cfg.cues.passed);

  const shoulderMid = midpoint(ls, rs);
  const dx = nose.x - shoulderMid.x;
  const dy = nose.y - shoulderMid.y;
  const angleFromVertical = Math.abs(Math.atan2(dx, -dy) * (180 / Math.PI));

  let verdict: RuleVerdict;
  if (angleFromVertical <= cfg.maxDeviationDeg / 2) verdict = "passed";
  else if (angleFromVertical <= cfg.maxDeviationDeg) verdict = "borderline";
  else verdict = "failed";

  const conf = Math.min(nose.visibility, (ls.visibility + rs.visibility) / 2);
  return finalize(cfg.id, cfg.name, verdict, cfg.cues, angleFromVertical, cfg.maxDeviationDeg, conf);
}

export function checkButtWink(
  frames: PoseFrame[],
  bounds: RepBounds,
  _torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.buttWink;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.unknownCue);

  const hip = dominantSide(bottomFrame, "left_hip", "right_hip");
  const shoulder = dominantSide(bottomFrame, "left_shoulder", "right_shoulder");
  if (!hip || !shoulder) return unknownResult(cfg.id, cfg.name, cfg.unknownCue);

  const conf = Math.min(hip.visibility, shoulder.visibility);
  if (conf < cfg.minConfidenceToFlag) {
    return { ruleId: cfg.id, ruleName: cfg.name, verdict: "unknown", cue: cfg.unknownCue, confidence: conf };
  }

  const hipShoulderXDiff = Math.abs(hip.x - shoulder.x);
  const tiltAngle = Math.atan2(hipShoulderXDiff, Math.abs(shoulder.y - hip.y)) * (180 / Math.PI);

  let verdict: RuleVerdict;
  if (tiltAngle < cfg.hipShoulderAngleThreshold / 2) verdict = "passed";
  else if (tiltAngle < cfg.hipShoulderAngleThreshold) verdict = "borderline";
  else verdict = "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, tiltAngle, cfg.hipShoulderAngleThreshold, conf);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute bar path drift as a percentage of torso length (used in RepMetrics). */
export function computeBarPathDriftPercent(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): number {
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);
  const barX = repFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    if (ls && rs) return midpoint(ls, rs).x;
    return null;
  }).filter((v): v is number => v !== null);

  if (!barX.length || torsoLen === 0) return 0;
  const smoothed = smoothMovingAverage(barX, 5);
  const drift = Math.max(...smoothed) - Math.min(...smoothed);
  return (drift / torsoLen) * 100;
}
