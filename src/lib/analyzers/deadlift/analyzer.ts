import type {
  LiftAnalyzer, PoseFrame, RepMetrics, FormAnalysis, VideoValidation, RuleResult,
} from "../../core/types";
import { segmentReps, invertedWristYSignal, type RepBounds } from "../../core/repSegmenter";
import { estimateSideViewConfidence, torsoLength } from "../../core/geometry";
import {
  estimateBottomDwell, buildTopFixes, findMainIssue,
} from "../../core/analysisCommon";
import { computeScore } from "../../core/scoring";
import {
  checkHipsShoot, checkBarDrift, checkHyperextension, checkHitching,
  computeBarPathDriftPercent,
} from "./rules";

const SIDE_VIEW_WARN_THRESHOLD = 0.15;
const MIN_FRAMES = 30;

const RULE_PRIORITY: Record<string, number> = {
  hipsShoot: 1,
  barDrift: 2,
  hitching: 3,
  hyperextension: 4,
};

const ISSUE_LABELS: Record<string, string> = {
  hipsShoot: "hips shooting up off the floor",
  barDrift: "bar drifting away from your legs",
  hyperextension: "leaning back at lockout",
  hitching: "hitching the bar at mid-thigh",
};

export class DeadliftAnalyzer implements LiftAnalyzer {
  readonly liftType = "deadlift";

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
    return segmentReps(frames, { signal: invertedWristYSignal, minDepthThreshold: 0.06 });
  }

  analyzeRep(frames: PoseFrame[], bounds: RepBounds, repNumber: number): RepMetrics {
    const startFrame = frames[bounds.startFrame];
    const lockoutFrame = frames[bounds.bottomFrame];
    const endFrame = frames[bounds.endFrame];

    // For deadlift: "descent" in our timing = the concentric pull (off-floor → lockout)
    // "ascent" in our timing = the eccentric (lockout → floor). We keep field
    // names from RepMetrics consistent for downstream consumers, but the UI
    // labels them appropriately per lift.
    const concentricDurationMs = (lockoutFrame?.timestamp ?? 0) - (startFrame?.timestamp ?? 0);
    const eccentricDurationMs = (endFrame?.timestamp ?? 0) - (lockoutFrame?.timestamp ?? 0);
    const lockoutDwellMs = estimateBottomDwell(frames, bounds, invertedWristYSignal);
    const torsoLen = torsoLength(lockoutFrame) ?? torsoLength(startFrame) ?? 0.3;

    const ruleResults: RuleResult[] = [
      checkHipsShoot(frames, bounds),
      checkBarDrift(frames, bounds, torsoLen),
      checkHyperextension(frames, bounds, torsoLen),
      checkHitching(frames, bounds),
    ];

    return {
      repNumber,
      startFrame: bounds.startFrame,
      bottomFrame: bounds.bottomFrame,
      endFrame: bounds.endFrame,
      startTimestamp: startFrame?.timestamp ?? 0,
      bottomTimestamp: lockoutFrame?.timestamp ?? 0,
      endTimestamp: endFrame?.timestamp ?? 0,
      descentDurationMs: concentricDurationMs,
      ascentDurationMs: eccentricDurationMs,
      bottomDwellMs: lockoutDwellMs,
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

    let overallVerdict: string;
    if (!mainIssue) {
      overallVerdict = `${repCount} of ${repCount} reps clean — pull looked solid.`;
    } else {
      overallVerdict = `${cleanReps} of ${repCount} reps clean; main issue is ${ISSUE_LABELS[mainIssue] ?? mainIssue}.`;
    }

    return {
      liftType: "deadlift",
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
