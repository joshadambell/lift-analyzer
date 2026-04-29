import type {
  LiftAnalyzer, PoseFrame, RepMetrics, FormAnalysis, VideoValidation, RuleResult,
} from "../../core/types";
import { segmentReps, type RepBounds } from "../../core/repSegmenter";
import { estimateSideViewConfidence, torsoLength } from "../../core/geometry";
import { estimateBottomDwell, buildTopFixes, findMainIssue } from "../../core/analysisCommon";
import { computeScore } from "../../core/scoring";
import {
  checkSquattingRDL, checkBarDrift, checkHyperextension, computeBarPathDriftPercent,
} from "./rules";

const SIDE_VIEW_WARN_THRESHOLD = 0.15;
const MIN_FRAMES = 30;

const RULE_PRIORITY: Record<string, number> = {
  squattingRDL: 1,
  barDrift: 2,
  hyperextension: 3,
};

const ISSUE_LABELS: Record<string, string> = {
  squattingRDL: "knee flexion — you're squatting the RDL instead of hinging",
  barDrift: "bar drifting away from your legs",
  hyperextension: "leaning back at lockout",
};

export class RDLAnalyzer implements LiftAnalyzer {
  readonly liftType = "romanian_deadlift";

  validateVideo(frames: PoseFrame[]): VideoValidation {
    if (frames.length < MIN_FRAMES) return failed(frames, `Video too short — only ${frames.length} frames. Need ${MIN_FRAMES}+.`);
    if (!frames.some((f) => f.confidence > 0.3)) return failed(frames, "No person detected.");

    const sideViewConf = estimateSideViewConfidence(frames);
    return {
      valid: true,
      sideViewConfidence: sideViewConf,
      personDetected: true,
      frameCount: frames.length,
      durationMs: frames.at(-1)?.timestamp ?? 0,
      rejectionReason: sideViewConf < SIDE_VIEW_WARN_THRESHOLD
        ? "Low side-view confidence — film perpendicular to the bar at hip height for best results."
        : undefined,
    };
  }

  segmentReps(frames: PoseFrame[]): RepBounds[] {
    return segmentReps(frames, { minDepthThreshold: 0.05 });
  }

  analyzeRep(frames: PoseFrame[], bounds: RepBounds, repNumber: number): RepMetrics {
    const startFrame = frames[bounds.startFrame];
    const bottomFrame = frames[bounds.bottomFrame];
    const endFrame = frames[bounds.endFrame];

    const descentDurationMs = (bottomFrame?.timestamp ?? 0) - (startFrame?.timestamp ?? 0);
    const ascentDurationMs = (endFrame?.timestamp ?? 0) - (bottomFrame?.timestamp ?? 0);
    const bottomDwellMs = estimateBottomDwell(frames, bounds);
    const torsoLen = torsoLength(bottomFrame) ?? torsoLength(startFrame) ?? 0.3;

    const ruleResults: RuleResult[] = [
      checkSquattingRDL(frames, bounds),
      checkBarDrift(frames, bounds, torsoLen),
      checkHyperextension(frames, bounds, torsoLen),
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
    const cleanReps = reps.filter((r) =>
      r.ruleResults.every((rr) => rr.verdict === "passed" || rr.verdict === "unknown")
    ).length;
    const mainIssue = findMainIssue(reps);

    const overallVerdict = !mainIssue
      ? `${cleanReps} of ${repCount} reps clean — hinge pattern looked solid.`
      : `${cleanReps} of ${repCount} reps clean; main issue is ${ISSUE_LABELS[mainIssue] ?? mainIssue}.`;

    return {
      liftType: "romanian_deadlift",
      repCount,
      reps,
      overallVerdict,
      topFixes: buildTopFixes(reps, RULE_PRIORITY),
      videoValidation: validation,
      score: computeScore(reps, RULE_PRIORITY),
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
