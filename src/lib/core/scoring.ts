import type { RepMetrics } from "./types";

export interface LiftScore {
  /** 0–100, priority-weighted pass rate across all reps */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** Per-rep scores (0–100), same ordering as FormAnalysis.reps */
  repScores: number[];
}

/**
 * Compute a 0–100 score for a set of reps.
 *
 * Verdict weights: passed = 1.0, borderline = 0.5, failed = 0.0.
 * "unknown" results are excluded from both numerator and denominator.
 *
 * Rule weights: 1 / priority rank (so priority-1 rules count ~7× more than
 * priority-7 rules). When no priorities are provided, all rules are equal.
 */
export function computeScore(
  reps: RepMetrics[],
  priorities: Record<string, number> = {},
): LiftScore {
  const repScores: number[] = [];

  for (const rep of reps) {
    const scoreable = rep.ruleResults.filter((r) => r.verdict !== "unknown");
    if (!scoreable.length) continue;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const r of scoreable) {
      const weight = priorities[r.ruleId] != null ? 1 / priorities[r.ruleId] : 1;
      const v = r.verdict === "passed" ? 1 : r.verdict === "borderline" ? 0.5 : 0;
      weightedSum += v * weight;
      totalWeight += weight;
    }
    repScores.push(Math.round((weightedSum / totalWeight) * 100));
  }

  if (!repScores.length) return { score: 0, grade: "F", repScores: [] };

  const score = Math.round(
    repScores.reduce((s, v) => s + v, 0) / repScores.length,
  );

  const grade: LiftScore["grade"] =
    score >= 85 ? "A"
    : score >= 70 ? "B"
    : score >= 55 ? "C"
    : score >= 40 ? "D"
    : "F";

  return { score, grade, repScores };
}
