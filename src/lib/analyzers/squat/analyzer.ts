import type {
  LiftAnalyzer,
  PoseFrame,
  RepMetrics,
  FormAnalysis,
  TopFix,
  VideoValidation,
  RuleResult,
} from "../../core/types";
import { segmentReps, type RepBounds } from "../../core/repSegmenter";
import {
  estimateSideViewConfidence,
  torsoLength,
  mean,
  midpoint,
  getKp,
} from "../../core/geometry";
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

const MIN_SIDE_VIEW_CONFIDENCE = 0.15;
const MIN_FRAMES = 30;
const MIN_REPS = 1;

export class SquatAnalyzer implements LiftAnalyzer {
  readonly liftType = "squat";

  validateVideo(frames: PoseFrame[]): VideoValidation {
    if (frames.length < MIN_FRAMES) {
      return {
        valid: false,
        sideViewConfidence: 0,
        personDetected: false,
        frameCount: frames.length,
        durationMs: frames.at(-1)?.timestamp ?? 0,
        rejectionReason: `Video too short — detected only ${frames.length} frames with pose data. Need at least ${MIN_FRAMES}.`,
      };
    }

    const personDetected = frames.some((f) => f.confidence > 0.3);
    if (!personDetected) {
      return {
        valid: false,
        sideViewConfidence: 0,
        personDetected: false,
        frameCount: frames.length,
        durationMs: frames.at(-1)?.timestamp ?? 0,
        rejectionReason: "No person detected in the video. Ensure good lighting and a clear view of the lifter.",
      };
    }

    const sideViewConf = estimateSideViewConfidence(frames);
    const durationMs = frames.at(-1)?.timestamp ?? 0;

    if (sideViewConf < MIN_SIDE_VIEW_CONFIDENCE) {
      return {
        valid: false,
        sideViewConfidence: sideViewConf,
        personDetected: true,
        frameCount: frames.length,
        durationMs,
        rejectionReason:
          "Camera angle does not appear to be a side view. This analyzer only supports side-view footage. Film from the left or right side with the bar perpendicular to the camera.",
      };
    }

    return {
      valid: true,
      sideViewConfidence: sideViewConf,
      personDetected: true,
      frameCount: frames.length,
      durationMs,
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

    // Bottom dwell: frames where hip Y changes < 1% of torso length
    const bottomDwellMs = estimateBottomDwell(frames, bounds);

    // Use mid-rep torso length as reference (most stable)
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

    const barPathDriftPercent = computeBarPathDriftPercent(frames, bounds, torsoLen);

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
      barPathDriftPercent,
    };
  }

  buildFormAnalysis(reps: RepMetrics[], validation: VideoValidation): FormAnalysis {
    const repCount = reps.length;

    // Depth summary for verdict line
    const depthResults = reps.map((r) => r.ruleResults.find((rr) => rr.ruleId === "depth"));
    const parallelCount = depthResults.filter((r) => r?.verdict === "passed").length;
    const failedDepth = depthResults.filter((r) => r?.verdict === "failed").length;

    // Find the most common failed rule
    const ruleCounts: Record<string, number> = {};
    for (const rep of reps) {
      for (const rule of rep.ruleResults) {
        if (rule.verdict === "failed" || rule.verdict === "borderline") {
          ruleCounts[rule.ruleId] = (ruleCounts[rule.ruleId] ?? 0) + 1;
        }
      }
    }

    const mainIssue = Object.entries(ruleCounts)
      .sort(([, a], [, b]) => b - a)
      .at(0)?.[0];

    const overallVerdict = buildVerdictLine(repCount, parallelCount, mainIssue, reps);
    const topFixes = buildTopFixes(reps, repCount);

    return {
      liftType: "squat",
      repCount,
      reps,
      overallVerdict,
      topFixes,
      videoValidation: validation,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateBottomDwell(frames: PoseFrame[], bounds: RepBounds): number {
  const threshold = 0.01; // hip Y must change by less than this to be "at bottom"
  let dwellStart: number | null = null;
  let dwellEnd: number | null = null;

  const bottomY = frames[bounds.bottomFrame] ? (() => {
    const lh = getKp(frames[bounds.bottomFrame], "left_hip");
    const rh = getKp(frames[bounds.bottomFrame], "right_hip");
    return lh && rh ? midpoint(lh, rh).y : lh?.y ?? rh?.y ?? 0;
  })() : 0;

  for (let i = bounds.startFrame; i <= bounds.endFrame; i++) {
    const f = frames[i];
    if (!f) continue;
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    const hipY = lh && rh ? midpoint(lh, rh).y : null;
    if (hipY !== null && Math.abs(hipY - bottomY) < threshold) {
      if (dwellStart === null) dwellStart = f.timestamp;
      dwellEnd = f.timestamp;
    }
  }

  if (dwellStart !== null && dwellEnd !== null) return dwellEnd - dwellStart;
  return 0;
}

function buildVerdictLine(
  repCount: number,
  parallelCount: number,
  mainIssueId: string | undefined,
  reps: RepMetrics[]
): string {
  const depthVerb = `${parallelCount} of ${repCount} rep${repCount === 1 ? "" : "s"} broke parallel`;
  if (!mainIssueId || mainIssueId === "depth") {
    return parallelCount === repCount
      ? `${depthVerb}. Depth is consistent.`
      : `${depthVerb}; focus on hitting depth first.`;
  }

  const issueLabels: Record<string, string> = {
    kneeTravel: "forward knee drift",
    hipShoot: "hip-shoot on the way up",
    barPath: "horizontal bar path drift",
    tempo: "pausing at the bottom",
    heelLift: "heel lift",
    headPosition: "head position",
    buttWink: "possible lower back rounding",
  };

  const label = issueLabels[mainIssueId] ?? mainIssueId;
  return `${depthVerb}; main issue is ${label} on the way down.`;
}

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

function buildTopFixes(reps: RepMetrics[], repCount: number): TopFix[] {
  // Aggregate failures across reps
  const issueMap: Record<string, { affectedReps: number[]; cue: string; priority: number }> = {};

  for (const rep of reps) {
    for (const rule of rep.ruleResults) {
      if (rule.verdict === "failed" || rule.verdict === "borderline") {
        if (!issueMap[rule.ruleId]) {
          issueMap[rule.ruleId] = {
            affectedReps: [],
            cue: rule.cue,
            priority: RULE_PRIORITY[rule.ruleId] ?? 99,
          };
        }
        issueMap[rule.ruleId].affectedReps.push(rep.repNumber);
      }
    }
  }

  return Object.entries(issueMap)
    .sort(([, a], [, b]) => a.priority - b.priority)
    .slice(0, 3)
    .map(([ruleId, info], i) => ({
      priority: i + 1,
      ruleId,
      description: ruleId.replace(/([A-Z])/g, " $1").toLowerCase(),
      affectedReps: info.affectedReps,
      cue: info.cue,
    }));
}
