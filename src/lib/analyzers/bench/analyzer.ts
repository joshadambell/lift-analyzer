import type {
  LiftAnalyzer, PoseFrame, RepMetrics, FormAnalysis, VideoValidation, RuleResult,
} from "../../core/types";
import { segmentReps, wristYSignal, type RepBounds } from "../../core/repSegmenter";
import { torsoLength, getKp, midpoint } from "../../core/geometry";
import { estimateBottomDwell, buildTopFixes, findMainIssue } from "../../core/analysisCommon";
import { computeScore } from "../../core/scoring";
import {
  checkPause, checkLockout, checkButtLift, checkBarPath, computeBarPathDriftPercent,
} from "./rules";

const MIN_FRAMES = 30;

const RULE_PRIORITY: Record<string, number> = {
  pause: 1,
  softLockout: 2,
  buttLift: 3,
  barPath: 4,
};

const ISSUE_LABELS: Record<string, string> = {
  pause: "bouncing the bar off the chest",
  softLockout: "soft lockout — finish elbows fully",
  buttLift: "hips lifting off the bench",
  barPath: "inconsistent bar path",
};

export class BenchPressAnalyzer implements LiftAnalyzer {
  readonly liftType = "bench_press";

  validateVideo(frames: PoseFrame[]): VideoValidation {
    if (frames.length < MIN_FRAMES) return failed(frames, `Video too short — only ${frames.length} frames. Need ${MIN_FRAMES}+.`);
    if (!frames.some((f) => f.confidence > 0.3)) return failed(frames, "No person detected in the video.");

    // Bench-specific orientation check: the lifter is supine, so shoulder Y
    // and hip Y should be close (horizontal torso). For a standing lift, the
    // gap is roughly equal to torso length. We require average |Δy| / torsoLen
    // to be below 0.4 across the early frames to accept the video as a bench.
    if (!isSupine(frames)) {
      return failed(
        frames,
        "Lifter doesn't appear to be lying on a bench. If this is a bench press, ensure the camera is filming from the side at bench height. Otherwise, switch to the correct lift type."
      );
    }

    return {
      valid: true,
      sideViewConfidence: 1,
      personDetected: true,
      frameCount: frames.length,
      durationMs: frames.at(-1)?.timestamp ?? 0,
      rejectionReason: undefined,
    };
  }

  segmentReps(frames: PoseFrame[]): RepBounds[] {
    return segmentReps(frames, { signal: wristYSignal, minDepthThreshold: 0.04 });
  }

  analyzeRep(frames: PoseFrame[], bounds: RepBounds, repNumber: number): RepMetrics {
    const startFrame = frames[bounds.startFrame];
    const bottomFrame = frames[bounds.bottomFrame];
    const endFrame = frames[bounds.endFrame];

    const descentDurationMs = (bottomFrame?.timestamp ?? 0) - (startFrame?.timestamp ?? 0);
    const ascentDurationMs = (endFrame?.timestamp ?? 0) - (bottomFrame?.timestamp ?? 0);
    const bottomDwellMs = estimateBottomDwell(frames, bounds, wristYSignal);
    const torsoLen = torsoLength(bottomFrame) ?? torsoLength(startFrame) ?? 0.3;

    const ruleResults: RuleResult[] = [
      checkPause(bottomDwellMs),
      checkLockout(frames, bounds),
      checkButtLift(frames, bounds, torsoLen),
      checkBarPath(frames, bounds, torsoLen),
    ];

    return {
      repNumber,
      startFrame: bounds.startFrame,
      bottomFrame: bounds.bottomFrame,
      endFrame: bounds.endFrame,
      startTimestamp: startFrame?.timestamp ?? 0,
      bottomTimestamp: bottomFrame?.timestamp ?? 0,
      endTimestamp: endFrame?.timestamp ?? 0,
      descentDurationMs,
      ascentDurationMs,
      bottomDwellMs,
      ruleResults,
      barPathDriftPercent: computeBarPathDriftPercent(frames, bounds, torsoLen),
    };
  }

  buildFormAnalysis(reps: RepMetrics[], validation: VideoValidation): FormAnalysis {
    const repCount = reps.length;
    const pausedReps = reps.filter((r) =>
      r.ruleResults.find((rr) => rr.ruleId === "pause")?.verdict === "passed"
    ).length;
    const mainIssue = findMainIssue(reps);

    const pauseSummary = `${pausedReps} of ${repCount} rep${repCount === 1 ? "" : "s"} paused cleanly`;
    const overallVerdict = !mainIssue
      ? `${pauseSummary}. Press looked solid.`
      : `${pauseSummary}; main issue is ${ISSUE_LABELS[mainIssue] ?? mainIssue}.`;

    return {
      liftType: "bench_press",
      repCount,
      reps,
      overallVerdict,
      topFixes: buildTopFixes(reps, RULE_PRIORITY),
      videoValidation: validation,
      score: computeScore(reps, RULE_PRIORITY),
    };
  }
}

/**
 * Detect supine torso orientation. In a side-view bench press, the shoulder
 * and hip midpoints sit at nearly the same Y. In a standing lift they're
 * separated by roughly torsoLength.
 *
 * We compute the ratio of vertical separation to total shoulder→hip distance.
 * For a horizontal torso the ratio is small (~0.0–0.3), for a vertical one
 * it's near 1.0. Threshold: 0.5 (anything under is "horizontal enough").
 */
function isSupine(frames: PoseFrame[]): boolean {
  const sample = frames.slice(0, Math.min(30, frames.length));
  const ratios: number[] = [];
  for (const f of sample) {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    if (!ls || !rs || !lh || !rh) continue;
    if (Math.min(ls.visibility, rs.visibility, lh.visibility, rh.visibility) < 0.4) continue;

    const sm = midpoint(ls, rs);
    const hm = midpoint(lh, rh);
    const dy = Math.abs(sm.y - hm.y);
    const total = Math.hypot(sm.x - hm.x, sm.y - hm.y);
    if (total < 0.05) continue; // body too small or keypoints collapsed
    ratios.push(dy / total);
  }
  if (ratios.length === 0) return false;
  const avgRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return avgRatio < 0.5;
}

function failed(frames: PoseFrame[], reason: string): VideoValidation {
  return {
    valid: false,
    sideViewConfidence: 0,
    personDetected: false,
    frameCount: frames.length,
    durationMs: frames.at(-1)?.timestamp ?? 0,
    rejectionReason: reason,
  };
}
