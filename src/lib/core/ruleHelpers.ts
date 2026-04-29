import type { RuleResult, RuleVerdict } from "./types";
import type { LiftKey } from "../knowledge";
import { getFault } from "../knowledge";

export interface CueSet {
  passed: string;
  borderline: string;
  failed: string;
  unknown?: string;
}

export function unknownResult(ruleId: string, ruleName: string, cue: string): RuleResult {
  return { ruleId, ruleName, verdict: "unknown", cue, confidence: 0 };
}

export function finalize(
  ruleId: string,
  ruleName: string,
  verdict: RuleVerdict,
  cues: CueSet,
  value: number,
  threshold: number,
  confidence: number,
  frameTimestamp?: number,
): RuleResult {
  const cue =
    verdict === "passed" ? cues.passed
    : verdict === "borderline" ? cues.borderline
    : cues.failed;
  return { ruleId, ruleName, verdict, value, threshold, cue, confidence, frameTimestamp };
}

/**
 * Returns a cuesFromFault function bound to a specific lift key.
 * The borderlineCue parameter is used verbatim when provided.
 */
export function makeCuesFromFault(liftKey: LiftKey) {
  return function cuesFromFault(
    faultId: string,
    passedCue: string,
    borderlineCue?: string,
  ): CueSet {
    const f = getFault(liftKey, faultId);
    if (!f) return { passed: passedCue, borderline: passedCue, failed: "Form fault detected." };
    const corrections = f.correction.map((c) => c.replace(/_/g, " ")).join("; ");
    return {
      passed: passedCue,
      borderline: borderlineCue ?? `Borderline ${f.fault.toLowerCase()}.`,
      failed: `${f.description}. Fix: ${corrections}.`,
    };
  };
}
