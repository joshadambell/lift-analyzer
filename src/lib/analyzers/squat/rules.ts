/**
 * Squat form rules based on StrongLifts methodology.
 * Reference: https://stronglifts.com/squat/
 *
 * Each rule has two layers:
 *   1. A config object (thresholds, keypoint names, cue text) — tunable without code
 *   2. A check function — only used when the geometry is too complex for a config
 *
 * Rule IDs are stable identifiers used in reports and tests.
 */

import type { PoseFrame, RuleResult, RuleVerdict } from "../../core/types";
import type { RepBounds } from "../../core/repSegmenter";
import {
  getKp,
  dominantSide,
  midpoint,
  distance,
  angleDeg,
  torsoLength,
  smoothMovingAverage,
  mean,
} from "../../core/geometry";

// ─── Rule configs (data-driven thresholds) ────────────────────────────────────

export const SQUAT_RULE_CONFIGS = {
  depth: {
    id: "depth",
    name: "Depth",
    // Hip crease must be BELOW knee top → hip Y > knee Y in normalized coords
    // Tolerance as fraction of torso length
    toleranceFraction: 0.02,
    passedCue: "Broke parallel — good depth.",
    borderlineCue: "Just at parallel — aim to descend another inch.",
    // StrongLifts: https://stronglifts.com/squat/#Squat_Depth
    failedCue:
      "Didn't break parallel — hips stayed above knees. Widen stance to shoulder-width with toes 30° out and push knees out as you descend.",
  },
  kneeTravel: {
    id: "kneeTravel",
    name: "Knee travel (no forward drift past mid-descent)",
    // If knee-X keeps increasing after 50% of depth is reached, flag it
    // StrongLifts: https://stronglifts.com/squat/#Knees
    driftFractionThreshold: 0.02, // knee X drift after mid-descent > 2% of torso = fail
    passedCue: "Knees stopped tracking forward at mid-descent — good.",
    borderlineCue: "Slight continued knee travel past mid-descent.",
    failedCue:
      "Knees kept drifting forward through the whole descent. Sit hips back earlier so knees stop moving once thighs are parallel.",
  },
  hipShoot: {
    id: "hipShoot",
    name: "Hip/chest rise ratio",
    // During ascent, hips should not outpace shoulders by more than 15%
    // StrongLifts: https://stronglifts.com/squat/#Back_Angle
    maxRatioDivergence: 0.15,
    passedCue: "Hips and chest rose together.",
    borderlineCue: "Slight hip lead on the way up — watch the bar path.",
    failedCue:
      "Hips shot up faster than your chest — the bar drifted forward. Drive chest and hips up together.",
  },
  barPath: {
    id: "barPath",
    name: "Bar path (shoulder-midpoint proxy)",
    // Max horizontal drift as fraction of torso length
    // StrongLifts: https://stronglifts.com/squat/#Bar_Path
    maxDriftFraction: 0.05,
    passedCue: "Bar tracked a vertical line — good balance.",
    borderlineCue: "Minor bar path drift — watch forward lean.",
    failedCue:
      "Bar drifted horizontally — you lost your balance point over the midfoot. Keep chest up and drive through the heels.",
  },
  tempo: {
    id: "tempo",
    name: "Bottom dwell (stretch reflex)",
    // StrongLifts: no pause at bottom — use stretch reflex
    maxBottomDwellMs: 500,
    passedCue: "Good tempo — stretch reflex used.",
    borderlineCue: "Slight pause at bottom — try to reverse immediately.",
    failedCue:
      "You paused at the bottom — you lost the stretch reflex. Descend with control and reverse immediately.",
  },
  heelLift: {
    id: "heelLift",
    name: "Heel lift (ankle stability)",
    // Proxy: large ankle angle change during descent indicates heel rise
    // StrongLifts: https://stronglifts.com/squat/#Feet
    maxAnkleFlexChange: 20, // degrees
    passedCue: "Heels stayed down through the descent.",
    borderlineCue: "Minor heel movement — verify with front-view footage.",
    failedCue:
      "Heel lift detected — work on ankle mobility or elevate heels temporarily while training dorsiflexion.",
  },
  headPosition: {
    id: "headPosition",
    name: "Head/neck alignment",
    // StrongLifts: head neutral, neither looking up nor down
    maxDeviationDeg: 35,
    passedCue: "Head neutral — good spinal alignment.",
    borderlineCue: "Slight head deviation — keep gaze forward.",
    failedCue:
      "Extreme head position — keep gaze forward, not up at the ceiling or down at the floor.",
  },
  buttWink: {
    id: "buttWink",
    name: "Lower back rounding (butt wink)",
    // StrongLifts: https://stronglifts.com/squat/#Lower_Back
    // Hard to detect reliably from 2D side view — high confidence threshold
    minConfidenceToFlag: 0.85,
    hipShoulderAngleThreshold: 15, // degrees of hip-shoulder line tilt toward floor = wink
    passedCue: "Lumbar appears neutral at the bottom.",
    unknownCue:
      "Cannot reliably assess lower back rounding from this camera angle — requires high-confidence keypoint visibility.",
    failedCue:
      "Possible posterior pelvic tilt at the bottom. Strengthen hip flexors and work on thoracic mobility.",
  },
} as const;

// ─── Rule check functions ─────────────────────────────────────────────────────

export function checkDepth(
  frames: PoseFrame[],
  bounds: RepBounds,
  repNumber: number,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.depth;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.failedCue);

  const hip = dominantSide(bottomFrame, "left_hip", "right_hip");
  const knee = dominantSide(bottomFrame, "left_knee", "right_knee");
  if (!hip || !knee || hip.visibility < 0.5 || knee.visibility < 0.5) {
    return unknownResult(cfg.id, cfg.name, cfg.failedCue);
  }

  const tolerance = torsoLen * cfg.toleranceFraction;
  // In normalized coords, larger Y = lower. Hip below knee = hip.y > knee.y
  const hipBelowKneeBy = hip.y - knee.y;
  const conf = Math.min(hip.visibility, knee.visibility);

  let verdict: RuleVerdict;
  if (hipBelowKneeBy > tolerance) verdict = "passed";
  else if (hipBelowKneeBy > -tolerance) verdict = "borderline";
  else verdict = "failed";

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: hipBelowKneeBy,
    threshold: tolerance,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    frameTimestamp: bottomFrame.timestamp,
    confidence: conf,
  };
}

export function checkKneeTravel(
  frames: PoseFrame[],
  bounds: RepBounds,
  repNumber: number,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.kneeTravel;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  if (repFrames.length < 6) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

  const kneeX = repFrames.map((f) => {
    const k = dominantSide(f, "left_knee", "right_knee");
    return k ? k.x : null;
  });

  const midDescentIdx = Math.floor(repFrames.length / 2);
  const firstHalf = kneeX.slice(0, midDescentIdx).filter((v): v is number => v !== null);
  const secondHalf = kneeX.slice(midDescentIdx).filter((v): v is number => v !== null);

  if (!firstHalf.length || !secondHalf.length) {
    return unknownResult(cfg.id, cfg.name, cfg.passedCue);
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
    repFrames
      .map((f) => dominantSide(f, "left_knee", "right_knee")?.visibility ?? 0)
  );

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: continuedDrift,
    threshold: driftThreshold,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: conf,
  };
}

export function checkHipShoot(
  frames: PoseFrame[],
  bounds: RepBounds,
  repNumber: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.hipShoot;
  const ascentFrames = frames.slice(bounds.bottomFrame, bounds.endFrame + 1);
  if (ascentFrames.length < 4) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

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

  // Measure rate of change over ascent (Y decreases = moving up)
  const hipDeltas: number[] = [];
  const shoulderDeltas: number[] = [];
  for (let i = 1; i < ascentFrames.length; i++) {
    const hd = hipY[i - 1] !== null && hipY[i] !== null ? (hipY[i - 1]! - hipY[i]!) : null;
    const sd = shoulderY[i - 1] !== null && shoulderY[i] !== null ? (shoulderY[i - 1]! - shoulderY[i]!) : null;
    if (hd !== null) hipDeltas.push(hd);
    if (sd !== null) shoulderDeltas.push(sd);
  }

  if (!hipDeltas.length || !shoulderDeltas.length) {
    return unknownResult(cfg.id, cfg.name, cfg.passedCue);
  }

  const avgHipRate = mean(hipDeltas);
  const avgShoulderRate = mean(shoulderDeltas);

  // If hips rise much faster than shoulders, it's a hip-shoot / good morning
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

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: divergence,
    threshold: cfg.maxRatioDivergence,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: conf,
  };
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

  if (barX.length < 4) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

  const smoothedBarX = smoothMovingAverage(barX, 5);
  const minX = Math.min(...smoothedBarX);
  const maxX = Math.max(...smoothedBarX);
  const drift = maxX - minX;
  const driftFraction = torsoLen > 0 ? drift / torsoLen : drift;

  const driftThreshold = cfg.maxDriftFraction;

  let verdict: RuleVerdict;
  if (driftFraction <= driftThreshold / 2) verdict = "passed";
  else if (driftFraction <= driftThreshold) verdict = "borderline";
  else verdict = "failed";

  const conf = mean(repFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    return ((ls?.visibility ?? 0) + (rs?.visibility ?? 0)) / 2;
  }));

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: driftFraction * 100,  // store as percentage
    threshold: driftThreshold * 100,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: conf,
  };
}

export function checkTempo(bottomDwellMs: number): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.tempo;

  let verdict: RuleVerdict;
  if (bottomDwellMs <= cfg.maxBottomDwellMs / 2) verdict = "passed";
  else if (bottomDwellMs <= cfg.maxBottomDwellMs) verdict = "borderline";
  else verdict = "failed";

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: bottomDwellMs,
    threshold: cfg.maxBottomDwellMs,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: 0.9,  // tempo is reliable from timestamps
  };
}

export function checkHeelLift(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.heelLift;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);

  // Proxy: measure angle at ankle (knee-ankle-heel) over descent
  // Large change indicates heel coming up
  const ankleAngles = repFrames.map((f) => {
    const knee = dominantSide(f, "left_knee", "right_knee");
    const ankle = dominantSide(f, "left_ankle", "right_ankle");
    const heel = dominantSide(f, "left_heel", "right_heel");
    if (!knee || !ankle || !heel) return null;
    if (knee.visibility < 0.5 || ankle.visibility < 0.5 || heel.visibility < 0.5) return null;
    return angleDeg(knee, ankle, heel);
  }).filter((v): v is number => v !== null);

  if (ankleAngles.length < 4) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

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

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: change,
    threshold: cfg.maxAnkleFlexChange,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: conf,
  };
}

export function checkHeadPosition(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.headPosition;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

  const nose = getKp(bottomFrame, "nose");
  const ls = getKp(bottomFrame, "left_shoulder");
  const rs = getKp(bottomFrame, "right_shoulder");
  if (!nose || !ls || !rs) return unknownResult(cfg.id, cfg.name, cfg.passedCue);

  const shoulderMid = midpoint(ls, rs);
  // Angle of nose relative to shoulder midpoint (vertical = 90°)
  const dx = nose.x - shoulderMid.x;
  const dy = nose.y - shoulderMid.y; // negative = nose above shoulders (expected)
  const angleFromVertical = Math.abs(Math.atan2(dx, -dy) * (180 / Math.PI));

  let verdict: RuleVerdict;
  if (angleFromVertical <= cfg.maxDeviationDeg / 2) verdict = "passed";
  else if (angleFromVertical <= cfg.maxDeviationDeg) verdict = "borderline";
  else verdict = "failed";

  const conf = Math.min(nose.visibility, (ls.visibility + rs.visibility) / 2);

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: angleFromVertical,
    threshold: cfg.maxDeviationDeg,
    cue:
      verdict === "passed"
        ? cfg.passedCue
        : verdict === "borderline"
          ? cfg.borderlineCue
          : cfg.failedCue,
    confidence: conf,
  };
}

export function checkButtWink(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = SQUAT_RULE_CONFIGS.buttWink;
  const bottomFrame = frames[bounds.bottomFrame];
  if (!bottomFrame) return unknownResult(cfg.id, cfg.name, cfg.unknownCue);

  // Hip-shoulder angle proxy: if hips tuck under (posterior pelvic tilt), the
  // hip-shoulder vector tilts forward (hip X moves ahead of shoulder X)
  const hip = dominantSide(bottomFrame, "left_hip", "right_hip");
  const shoulder = dominantSide(bottomFrame, "left_shoulder", "right_shoulder");
  if (!hip || !shoulder) return unknownResult(cfg.id, cfg.name, cfg.unknownCue);

  const conf = Math.min(hip.visibility, shoulder.visibility);
  if (conf < cfg.minConfidenceToFlag) {
    return { ruleId: cfg.id, ruleName: cfg.name, verdict: "unknown", cue: cfg.unknownCue, confidence: conf };
  }

  // In side view: if hip X is significantly further forward than shoulder X (camera-right),
  // it suggests posterior tilt. This is a weak proxy.
  const hipShoulderXDiff = Math.abs(hip.x - shoulder.x);
  const tiltAngle = Math.atan2(hipShoulderXDiff, Math.abs(shoulder.y - hip.y)) * (180 / Math.PI);

  let verdict: RuleVerdict;
  if (tiltAngle < cfg.hipShoulderAngleThreshold / 2) verdict = "passed";
  else if (tiltAngle < cfg.hipShoulderAngleThreshold) verdict = "borderline";
  else verdict = "failed";

  return {
    ruleId: cfg.id,
    ruleName: cfg.name,
    verdict,
    value: tiltAngle,
    threshold: cfg.hipShoulderAngleThreshold,
    cue: verdict === "passed" ? cfg.passedCue : verdict === "failed" ? cfg.failedCue : cfg.unknownCue,
    confidence: conf,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unknownResult(ruleId: string, ruleName: string, cue: string): RuleResult {
  return { ruleId, ruleName, verdict: "unknown", cue, confidence: 0 };
}

/** Compute bar path drift as a percentage of torso length */
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
