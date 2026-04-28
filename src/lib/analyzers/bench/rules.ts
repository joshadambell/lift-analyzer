/**
 * Bench press form rules.
 *
 * Camera assumption: side view of the bench. Lifter is supine. The bar
 * descends to chest (wrist-Y increases) and ascends back to lockout
 * (wrist-Y decreases) — same direction convention as squat.
 *
 * Front-view-only KB faults (elbow flare, uneven bar) are intentionally
 * NOT detected here — flagging them from a side view would produce false
 * positives. The narrative API still receives the KB context for those
 * faults so the LLM can mention them generically if relevant.
 *
 * Rep bounds semantics:
 *   bounds.startFrame  = bar at lockout (rep start)
 *   bounds.bottomFrame = bar on chest
 *   bounds.endFrame    = bar back at lockout
 */

import type { PoseFrame, RuleResult, RuleVerdict } from "../../core/types";
import type { RepBounds } from "../../core/repSegmenter";
import {
  getKp, dominantSide, midpoint, angleDeg, smoothMovingAverage, mean,
} from "../../core/geometry";
import { getFault } from "../../knowledge";

interface CueSet { passed: string; borderline: string; failed: string; }

function cuesFromFault(faultId: string, passedCue: string, borderlineCue?: string): CueSet {
  const f = getFault("bench_press", faultId);
  if (!f) return { passed: passedCue, borderline: passedCue, failed: "Form fault detected." };
  const corrections = f.correction.map((c) => c.replace(/_/g, " ")).join("; ");
  return {
    passed: passedCue,
    borderline: borderlineCue ?? `Borderline ${f.fault.toLowerCase()}.`,
    failed: `${f.description}. Fix: ${corrections}.`,
  };
}

export const BENCH_RULE_CONFIGS = {
  pause: {
    id: "pause",
    name: "Pause on chest (vs bounce)",
    /** Min dwell time at the bottom for a "paused" rep, ms */
    minPauseMs: 400,
    /** Below this is a clear bounce */
    bounceThresholdMs: 100,
    cues: cuesFromFault(
      "bp_fault_2",
      "Solid pause on the chest before pressing.",
      "Quick reversal — borderline pause."
    ),
  },
  softLockout: {
    id: "softLockout",
    name: "Lockout completion",
    /** Min elbow extension angle at lockout */
    minLockoutAngle: 165,
    cues: cuesFromFault(
      "bp_fault_5",
      "Full elbow extension at lockout.",
      "Slight elbow bend at lockout — finish strong."
    ),
  },
  buttLift: {
    id: "buttLift",
    name: "Hip stability on bench",
    /** Max hip-Y change during the press as fraction of torso length */
    maxHipDriftFraction: 0.06,
    cues: cuesFromFault(
      "bp_fault_3",
      "Hips stayed planted on the bench.",
      "Slight hip movement during the press."
    ),
  },
  barPath: {
    id: "barPath",
    name: "Bar path consistency",
    /** Max wrist-X drift as fraction of torso length */
    maxDriftFraction: 0.10,
    cues: {
      passed: "Bar path stayed consistent.",
      borderline: "Minor bar path variation.",
      failed: "Bar drifted significantly during the press. Aim for a slight J-curve from chest back toward shoulder lockout.",
    } satisfies CueSet,
  },
} as const;

export function checkPause(bottomDwellMs: number): RuleResult {
  const cfg = BENCH_RULE_CONFIGS.pause;
  // For paused/competition bench: longer is better. We flag bounce, not slow press.
  const verdict: RuleVerdict =
    bottomDwellMs >= cfg.minPauseMs ? "passed"
    : bottomDwellMs >= cfg.bounceThresholdMs ? "borderline" : "failed";
  return finalize(cfg.id, cfg.name, verdict, cfg.cues, bottomDwellMs, cfg.minPauseMs, 0.9);
}

export function checkLockout(
  frames: PoseFrame[],
  bounds: RepBounds
): RuleResult {
  const cfg = BENCH_RULE_CONFIGS.softLockout;
  // Check elbow angle at start (locked out at unrack) and end (locked out at finish)
  const endFrame = frames[bounds.endFrame];
  if (!endFrame) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const shoulder = dominantSide(endFrame, "left_shoulder", "right_shoulder");
  const elbow = dominantSide(endFrame, "left_elbow", "right_elbow");
  const wrist = dominantSide(endFrame, "left_wrist", "right_wrist");
  if (!shoulder || !elbow || !wrist) return unknown(cfg.id, cfg.name, cfg.cues.passed);
  if (Math.min(shoulder.visibility, elbow.visibility, wrist.visibility) < 0.5) {
    return unknown(cfg.id, cfg.name, cfg.cues.passed);
  }

  const angle = angleDeg(shoulder, elbow, wrist);
  const verdict: RuleVerdict =
    angle >= cfg.minLockoutAngle ? "passed"
    : angle >= cfg.minLockoutAngle - 10 ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, angle, cfg.minLockoutAngle, Math.min(shoulder.visibility, elbow.visibility, wrist.visibility));
}

export function checkButtLift(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = BENCH_RULE_CONFIGS.buttLift;
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);
  if (repFrames.length < 4 || torsoLen === 0) return unknown(cfg.id, cfg.name, cfg.cues.passed);

  const hipY = repFrames.map((f) => {
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    if (lh && rh) return midpoint(lh, rh).y;
    if (lh) return lh.y;
    if (rh) return rh.y;
    return null;
  }).filter((v): v is number => v !== null);

  if (hipY.length < 4) return unknown(cfg.id, cfg.name, cfg.cues.passed);
  const smoothed = smoothMovingAverage(hipY, 3);
  // For supine lifter, hip moving "up" means hip Y *decreases* — so total range matters
  const range = Math.max(...smoothed) - Math.min(...smoothed);
  const fraction = range / torsoLen;

  const verdict: RuleVerdict =
    fraction <= cfg.maxHipDriftFraction / 2 ? "passed"
    : fraction <= cfg.maxHipDriftFraction ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, fraction * 100, cfg.maxHipDriftFraction * 100, 0.7);
}

export function checkBarPath(
  frames: PoseFrame[],
  bounds: RepBounds,
  torsoLen: number
): RuleResult {
  const cfg = BENCH_RULE_CONFIGS.barPath;
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);
  const xs = repFrames.map((f) => {
    const lw = getKp(f, "left_wrist");
    const rw = getKp(f, "right_wrist");
    if (lw && rw) return midpoint(lw, rw).x;
    if (lw) return lw.x;
    if (rw) return rw.x;
    return null;
  }).filter((v): v is number => v !== null);

  if (xs.length < 4 || torsoLen === 0) return unknown(cfg.id, cfg.name, cfg.cues.passed);
  const smoothed = smoothMovingAverage(xs, 5);
  const drift = (Math.max(...smoothed) - Math.min(...smoothed)) / torsoLen;

  const verdict: RuleVerdict =
    drift <= cfg.maxDriftFraction / 2 ? "passed"
    : drift <= cfg.maxDriftFraction ? "borderline" : "failed";

  return finalize(cfg.id, cfg.name, verdict, cfg.cues, drift * 100, cfg.maxDriftFraction * 100, 0.7);
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

export function computeBarPathDriftPercent(
  frames: PoseFrame[], bounds: RepBounds, torsoLen: number
): number {
  const repFrames = frames.slice(bounds.startFrame, bounds.endFrame + 1);
  const xs = repFrames.map((f) => {
    const lw = getKp(f, "left_wrist");
    const rw = getKp(f, "right_wrist");
    if (lw && rw) return midpoint(lw, rw).x;
    return null;
  }).filter((v): v is number => v !== null);
  if (!xs.length || torsoLen === 0) return 0;
  const smoothed = smoothMovingAverage(xs, 5);
  return ((Math.max(...smoothed) - Math.min(...smoothed)) / torsoLen) * 100;
}
