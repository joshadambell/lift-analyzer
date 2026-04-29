import type {
  LiftAnalyzer,
  PoseFrame,
  RepMetrics,
  FormAnalysis,
  VideoValidation,
  RuleResult,
} from "../../core/types";
import { segmentReps, type RepBounds } from "../../core/repSegmenter";
import {
  estimateSideViewConfidence,
  torsoLength,
} from "../../core/geometry";
import {
  estimateBottomDwell,
  buildTopFixes,
  findMainIssue,
  countPassed,
} from "../../core/analysisCommon";
import { computeScore } from "../../core/scoring";
import {
  checkDepth,
  checkKneeTravel,
  checkHipShoot,
  checkBarPath,
  checkTempo,
  checkHeelLift,
  checkHeadPosition,
  checkButtWink,
  computeBarPathDriftPercent,
} from "./rules";

const SIDE_VIEW_WARN_THRESHOLD = 0.15;
const MIN_FRAMES = 30;

const RULE_PRIORITY: Record<string, number> = {
  depth: 1,
  kneeTravel: 2,
  hipShoot: 3,
  barPath: 4,
  heelLift: 5,
  tempo: 6,
  buttWink: 7,
  headPosition: 8,
};

const ISSUE_LABELS: Record<string, string> = {
  kneeTravel: "forward knee drift",
  hipShoot: "hip-shoot on the way up",
  barPath: "horizontal bar path drift",
  tempo: "pausing at the bottom",
  heelLift: "heel lift",
  headPosition: "head position",
  buttWink: "possible lower back rounding",
};

export class SquatAnalyzer implements LiftAnalyzer {
  readonly liftType = "squat";

  validateVideo(frames: PoseFrame[]): VideoValidation {
    if (frames.length < MIN_FRAMES) {
      return failedValidation(frames, `Video too short — only ${frames.length} frames with pose data. Need ${MIN_FRAMES}+.`);
    }
    const personDetected = frames.some((f) => f.confidence > 0.3);
    if (!personDetected) {
      return failedValidation(frames, "No person detected. Check lighting and ensure the lifter is fully in frame.");
    }

    const sideViewConf = estimateSideViewConfidence(frames);
    const angleWarning = sideViewConf < SIDE_VIEW_WARN_THRESHOLD
      ? "Low side-view confidence — some checks may be less accurate. Position the camera perpendicular to the bar at hip height."
      : undefined;

    return {
      valid: true,
      sideViewConfidence: sideViewConf,
      personDetected: true,
      frameCount: frames.length,
      durationMs: frames.at(-1)?.timestamp ?? 0,
      rejectionReason: angleWarning,
    };
  }

  segmentReps(frames: PoseFrame[]): RepBounds[] {
    return segmentReps(frames);
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
      checkDepth(frames, bounds, repNumber, torsoLen),
      checkKneeTravel(frames, bounds, repNumber, torsoLen),
      checkHipShoot(frames, bounds, repNumber),
      checkBarPath(frames, bounds, torsoLen),
      checkTempo(bottomDwellMs),
      checkHeelLift(frames, bounds),
      checkHeadPosition(frames, bounds),
      checkButtWink(frames, bounds, torsoLen),
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
    const parallelCount = countPassed(reps, "depth");
    const mainIssue = findMainIssue(reps);

    const depthVerb = `${parallelCount} of ${repCount} rep${repCount === 1 ? "" : "s"} broke parallel`;
    let overallVerdict: string;
    if (!mainIssue || mainIssue === "depth") {
      overallVerdict = parallelCount === repCount
        ? `${depthVerb}. Depth is consistent.`
        : `${depthVerb}; focus on hitting depth first.`;
    } else {
      overallVerdict = `${depthVerb}; main issue is ${ISSUE_LABELS[mainIssue] ?? mainIssue}.`;
    }

    return {
      liftType: "squat",
      repCount,
      reps,
      overallVerdict,
      topFixes: buildTopFixes(reps, RULE_PRIORITY),
      videoValidation: validation,
      score: computeScore(reps, RULE_PRIORITY),
    };
  }
}

function failedValidation(frames: PoseFrame[], reason: string): VideoValidation {
  return {
    valid: false,
    sideViewConfidence: 0,
    personDetected: false,
    frameCount: frames.length,
    durationMs: frames.at(-1)?.timestamp ?? 0,
    rejectionReason: reason,
  };
}
