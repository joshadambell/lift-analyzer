/**
 * Deadlift form rules. KB-sourced cue language; numeric thresholds tunable here.
 *
 * Rep bounds semantics (driven by invertedWristYSignal):
 *   bounds.startFrame  = bar on floor (setup)
 *   bounds.bottomFrame = lockout (top of pull) — yes, "bottom" in our convention
 *                        means "deepest into rep", which is lockout for deadlift
 *   bounds.endFrame    = bar back on floor
 */

import type { PoseFrame, RuleResult, RuleVerdict } from "../../core/types";
import type { RepBounds } from "../../core/repSegmenter";
import {
  getKp,
  dominantSide,
  midpoint,
  smoothMovingAverage,
  mean,
  facingSign,
} from "../../core/geometry";
import { getFault } from "../../knowledge";

interface CueSet { passed: string; borderline: string; failed: string; }

function cuesFromFault(faultId: string, passedCue: string, borderlineCue?: string): CueSet {
  const f = getFault("deadlift", faultId);
  if (!f) return { passed: passedCue, borderline: passedCue, failed: "Form fault detected." };
  const corrections = f.correction.map((c) => c.replace(/_/g, " ")).join("; ");
  return {
    passed: passedCue,
    borderline: borderlineCue ?? `Borderline ${f.fault.toLowerCase()}.`,
    failed: `${f.description}. Fix: ${corrections}.`,
  };
}

export const DEADLIFT_RULE_CONFIGS = {
  hipsShoot: {
    id: "hipsShoot",
    name: "Hip drive vs back angle (initial pull)",
    /** Max ratio of hip-rate to shoulder-rate during the first 30% of the pull */
    maxRatioDivergence: 0.20,
    cues: cuesFromFault("dl_fault_1", "Hips and shoulders rose together off the floor.", "Slight hip lead off the floor."),
  },
  barDrift: {
    id: "barDrift",
    name: "Bar path proximity to legs",
    /** Max horizontal wrist drift as fraction of torso length over the pull */
    maxDriftFraction: 0.06,
    cues: cuesFromFault("dl_fault_2", "Bar tracked close to legs throughout.", "Slight bar drift from legs."),
  },
  hyperextension: {
    id: "hyperextension",
    name: "Lockout position",
    /** Max lean-back angle (shoulder behind hip in X) at lockout, normalized */
    maxLeanBackFraction: 0.08,
    cues: cuesFromFault("dl_fault_4", "Stood tall at lockout — no excessive lean back.", "Slight backward lean at lockout."),
  },
  hitching: {
    id: "hitching",
    name: "Continuous bar travel (no hitching)",
    /** Max stalls (non-monotonic dips) in wrist-Y during ascent */
    maxStallCount: 1,
    cues: cuesFromFault("dl_fault_5", "Smooth continuous pull from floor to lockout.", "Possible mid-thigh hesitation."),
  },
} as const;

export function checkHipsShoot(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = DEADLIFT_RULE_CONFIGS.hipsShoot;
  // Concentric phase = startFrame → bottomFrame (lockout). First 30% of pull.
  const concentric = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  if (concentric.length < 6) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const initialPhaseEnd = Math.max(3, Math.floor(concentric.length * 0.30));
  const phaseFrames = concentric.slice(0, initialPhaseEnd);

  const hipY = phaseFrames.map((f) => {
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    return lh && rh ? midpoint(lh, rh).y : null;
  });
  const shoulderY = phaseFrames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    return ls && rs ? midpoint(ls, rs).y : null;
  });

  const hipDeltas: number[] = [];
  const shoulderDeltas: number[] = [];
  for (let i = 1; i < phaseFrames.length; i++) {
    if (hipY[i - 1] !== null && hipY[i] !== null) hipDeltas.push(hipY[i - 1]! - hipY[i]!);
    if (shoulderY[i - 1] !== null && shoulderY[i] !== null) shoulderDeltas.push(shoulderY[i - 1]! - shoulderY[i]!);
  }

  if (!hipDeltas.length || !shoulderDeltas.length) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const avgHip = mean(hipDeltas);
  const avgShoulder = mean(shoulderDeltas);
  const divergence = avgHip > 0 && avgShoulder > 0
    ? (avgHip - avgShoulder) / Math.max(avgHip, avgShoulder)
    : 0;

  const verdict: RuleVerdict =
    divergence < cfg.maxRatioDivergence / 2 ? "passed"
    : divergence < cfg.maxRatioDivergence ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, divergence, cfg.maxRatioDivergence, 0.8);
}

export function checkBarDrift(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = DEADLIFT_RULE_CONFIGS.barDrift;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  // Wrist X distance from ankle X: bar should track near the leg line.
  const distances = repFrames.map((f) => {
    const wrist = dominantSide(f, "left_wrist", "right_wrist");
    const ankle = dominantSide(f, "left_ankle", "right_ankle");
    if (!wrist || !ankle) return null;
    if (wrist.visibility < 0.5 || ankle.visibility < 0.5) return null;
    return Math.abs(wrist.x - ankle.x);
  }).filter((v): v is number => v !== null);

  if (distances.length < 4 || torsoLen === 0) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const smoothed = smoothMovingAverage(distances, 5);
  const maxDrift = Math.max(...smoothed) / torsoLen;

  const verdict: RuleVerdict =
    maxDrift <= cfg.maxDriftFraction / 2 ? "passed"
    : maxDrift <= cfg.maxDriftFraction ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, maxDrift * 100, cfg.maxDriftFraction * 100, 0.8);
}

export function checkHyperextension(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = DEADLIFT_RULE_CONFIGS.hyperextension;
  const lockout = frames[bounds.bottomFrame];
  if (!lockout || torsoLen === 0) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const shoulder = dominantSide(lockout, "left_shoulder", "right_shoulder");
  const hip = dominantSide(lockout, "left_hip", "right_hip");
  if (!shoulder || !hip) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  // Use facing direction so we measure backward lean specifically (the fault),
  // not forward lean (a different fault). If facing direction is undetermined
  // (no visible feet), fall back to "unknown" — better than guessing.
  const facing = facingSign(lockout);
  if (facing === 0) {
    return unknown(cfg.id, cfg.name, "Cannot determine facing direction at lockout — feet not clearly visible.");
  }

  // backwardLean > 0 = shoulders behind hips relative to facing dir = the fault
  const backwardLean = (hip.x - shoulder.x) * facing / torsoLen;

  let verdict: RuleVerdict;
  if (backwardLean <= cfg.maxLeanBackFraction / 2) verdict = "passed";
  else if (backwardLean <= cfg.maxLeanBackFraction) verdict = "borderline";
  else verdict = "failed";

  return finalize(
    cfg.id, cfg.name, verdict, cfg.cues,
    backwardLean * 100, cfg.maxLeanBackFraction * 100,
    Math.min(shoulder.visibility, hip.visibility)
  );
}

export function checkHitching(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = DEADLIFT_RULE_CONFIGS.hitching;
  // Look for non-monotonic wrist-Y during the concentric pull
  const concentric = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  if (concentric.length < 8) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const wristY = concentric.map((f) => {
    const w = dominantSide(f, "left_wrist", "right_wrist");
    return w ? w.y : null;
  }).filter((v): v is number => v !== null);
  if (wristY.length < 8) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const smoothed = smoothMovingAverage(wristY, 3);
  // Wrist-Y should monotonically decrease during deadlift concentric.
  // Count "stalls" — frames where wrist briefly moves DOWN (Y increases) by
  // more than a small threshold.
  let stalls = 0;
  const stallThreshold = 0.005;
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] - smoothed[i - 1] > stallThreshold) stalls++;
  }

  const verdict: RuleVerdict =
    stalls === 0 ? "passed"
    : stalls <= cfg.maxStallCount ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, stalls, cfg.maxStallCount, 0.7);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unknown(ruleId: string, ruleName: string, cue: string): RuleResult {
  return { ruleId, ruleName, verdict: "unknown", cue, confidence: 0 };
}

function finalize(
  ruleId: string, ruleName: string, verdict: RuleVerdict, cues: CueSet,
  value: number, threshold: number, confidence: number
): RuleResult {
  const cue = verdict === "passed" ? cues.passed : verdict === "borderline" ? cues.borderline : cues.failed;
  return { ruleId, ruleName, verdict, value, threshold, cue, confidence };
}

/** Wrist X drift over the full rep (returned in RepMetrics.barPathDriftPercent) */
export function computeBarPathDriftPercent(
  frames: PoseFrame[], bounds: RepBounds, torsoLen: number
): number {
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);
  const xs = repFrames.map((f) => {
    const w = dominantSide(f, "left_wrist", "right_wrist");
    return w ? w.x : null;
  }).filter((v): v is number => v !== null);
  if (!xs.length || torsoLen === 0) return 0;
  const smoothed = smoothMovingAverage(xs, 5);
  return ((Math.max(...smoothed) - Math.min(...smoothed)) / torsoLen) * 100;
}
