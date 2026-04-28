import type {
  LiftAnalyzer, PoseFrame, RepMetrics, FormAnalysis, VideoValidation, RuleResult,
} from "../../core/types";
import { segmentReps, wristYSignal, type RepBounds } from "../../core/repSegmenter";
import { torsoLength } from "../../core/geometry";
import { estimateBottomDwell, buildTopFixes, findMainIssue } from "../../core/analysisCommon";
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

    // Side-view check from estimateSideViewConfidence assumes a vertical lifter
    // — irrelevant for supine bench. We skip the angle warning for bench and
    // expect the user to film from the side (this is the standard angle).
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
    };
  }
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
