/**
 * Romanian Deadlift form rules.
 *
 * Rep bounds semantics (driven by hipYSignal — same as squat):
 *   bounds.startFrame  = standing start
 *   bounds.bottomFrame = deepest hinge
 *   bounds.endFrame    = back to standing
 */

import type { PoseFrame, RuleResult, RuleVerdict } from "../../core/types";
import type { RepBounds } from "../../core/repSegmenter";
import {
  dominantSide, angleDeg, smoothMovingAverage, facingSign,
} from "../../core/geometry";
import { type CueSet, unknownResult, finalize, makeCuesFromFault } from "../../core/ruleHelpers";

const cuesFromFault = makeCuesFromFault("romanian_deadlift");

export const RDL_RULE_CONFIGS = {
  squattingRDL: {
    id: "squattingRDL",
    name: "Knee angle constancy (no squat pattern)",
    /** Max change in knee angle from start to bottom — RDL knees should stay nearly constant */
    maxKneeAngleChangeDeg: 25,
    cues: cuesFromFault(
      "rdl_fault_1",
      "Knees stayed soft and near-constant — clean hinge pattern.",
      "Some knee flexion during descent — borderline."
    ),
  },
  barDrift: {
    id: "barDrift",
    name: "Bar/wrist proximity to legs",
    maxDriftFraction: 0.06,
    cues: cuesFromFault(
      "rdl_fault_2",
      "Bar tracked close to your legs throughout.",
      "Slight bar drift away from legs."
    ),
  },
  hyperextension: {
    id: "hyperextension",
    name: "Lockout position",
    maxLeanBackFraction: 0.08,
    cues: cuesFromFault(
      "rdl_fault_4",
      "Stood tall at lockout — no excessive lean back.",
      "Slight backward lean at lockout."
    ),
  },
} as const;

export function checkSquattingRDL(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = RDL_RULE_CONFIGS.squattingRDL;
  const startFrame = frames[bounds.startFrame];
  const bottomFrame = frames[bounds.bottomFrame];
  if (!startFrame || !bottomFrame) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const startAngle = kneeAngle(startFrame);
  const bottomAngle = kneeAngle(bottomFrame);
  if (startAngle === null || bottomAngle === null) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  // RDL knee should stay roughly constant. Squat pattern = significant flexion (smaller angle).
  const change = Math.abs(startAngle - bottomAngle);
  const verdict: RuleVerdict =
    change <= cfg.maxKneeAngleChangeDeg / 2 ? "passed"
    : change <= cfg.maxKneeAngleChangeDeg ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, change, cfg.maxKneeAngleChangeDeg, 0.8);
}

export function checkBarDrift(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = RDL_RULE_CONFIGS.barDrift;
  const repFrames = frames.slice(bounds.startFrame, bounds.bottomFrame + 1);
  const distances = repFrames.map((f) => {
    const wrist = dominantSide(f, "left_wrist", "right_wrist");
    const knee = dominantSide(f, "left_knee", "right_knee");
    if (!wrist || !knee) return null;
    if (wrist.visibility < 0.5 || knee.visibility < 0.5) return null;
    return Math.abs(wrist.x - knee.x);
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
  const cfg = RDL_RULE_CONFIGS.hyperextension;
  const lockout = frames[bounds.endFrame];
  if (!lockout || torsoLen === 0) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const shoulder = dominantSide(lockout, "left_shoulder", "right_shoulder");
  const hip = dominantSide(lockout, "left_hip", "right_hip");
  if (!shoulder || !hip) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const facing = facingSign(lockout);
  if (facing === 0) {
    return unknown(cfg.id, cfg.name, "Cannot determine facing direction at lockout — feet not clearly visible.");
  }

  // backwardLean > 0 = shoulders behind hips relative to facing direction
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kneeAngle(frame: PoseFrame): number | null {
  const hip = dominantSide(frame, "left_hip", "right_hip");
  const knee = dominantSide(frame, "left_knee", "right_knee");
  const ankle = dominantSide(frame, "left_ankle", "right_ankle");
  if (!hip || !knee || !ankle) return null;
  if (Math.min(hip.visibility, knee.visibility, ankle.visibility) < 0.5) return null;
  return angleDeg(hip, knee, ankle);
}

const unknown = unknownResult;

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
