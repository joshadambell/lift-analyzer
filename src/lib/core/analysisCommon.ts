/**
 * Shared post-rep analysis helpers used by every per-lift analyzer.
 * Rep-level geometric checks live in each lift's rules.ts; this file is
 * pure aggregation and bookkeeping.
 */

import type { PoseFrame, RepMetrics, TopFix } from "./types";
import type { RepBounds, SignalExtractor } from "./repSegmenter";
import { hipYSignal } from "./repSegmenter";

/**
 * Bottom-dwell duration: how long the primary signal stays near its peak.
 * For squat/RDL this measures pause-at-bottom; for deadlift it measures
 * lockout dwell; for bench it measures pause-on-chest.
 */
export function estimateBottomDwell(
  frames: PoseFrame[],
  bounds: RepBounds,
  signal: SignalExtractor = hipYSignal,
  threshold: number = 0.01
): number {
  const peakFrame = frames[bounds.bottomFrame];
  if (!peakFrame) return 0;
  const peakValue = signal(peakFrame);
  if (Number.isNaN(peakValue)) return 0;

  let dwellStart: number | null = null;
  let dwellEnd: number | null = null;

  for (let i = bounds.startFrame; i <= bounds.endFrame; i++) {
    const f = frames[i];
    if (!f) continue;
    const v = signal(f);
    if (Number.isNaN(v)) continue;
    if (Math.abs(v - peakValue) < threshold) {
      if (dwellStart === null) dwellStart = f.timestamp;
      dwellEnd = f.timestamp;
    }
  }

  return dwellStart !== null && dwellEnd !== null ? dwellEnd - dwellStart : 0;
}

/**
 * Build a top-3 fixes list aggregated across reps.
 * `priorities` maps ruleId → priority rank (lower = more important).
 */
export function buildTopFixes(
  reps: RepMetrics[],
  priorities: Record<string, number>
): TopFix[] {
  const issueMap: Record<string, { affectedReps: number[]; cue: string; priority: number }> = {};

  for (const rep of reps) {
    for (const rule of rep.ruleResults) {
      if (rule.verdict === "failed" || rule.verdict === "borderline") {
        if (!issueMap[rule.ruleId]) {
          issueMap[rule.ruleId] = {
            affectedReps: [],
            cue: rule.cue,
            priority: priorities[rule.ruleId] ?? 99,
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

/** Most-frequent failed/borderline rule across reps. */
export function findMainIssue(reps: RepMetrics[]): string | undefined {
  const counts: Record<string, number> = {};
  for (const rep of reps) {
    for (const rule of rep.ruleResults) {
      if (rule.verdict === "failed" || rule.verdict === "borderline") {
        counts[rule.ruleId] = (counts[rule.ruleId] ?? 0) + 1;
      }
    }
  }
  return Object.entries(counts).sort(([, a], [, b]) => b - a).at(0)?.[0];
}

export function countPassed(reps: RepMetrics[], ruleId: string): number {
  return reps.filter((r) => r.ruleResults.find((rr) => rr.ruleId === ruleId)?.verdict === "passed").length;
}
