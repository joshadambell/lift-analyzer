import type { LiftAnalyzer } from "../core/types";
import { SquatAnalyzer } from "./squat/analyzer";

// Registry of all lift analyzers.
// To add deadlift: import DeadliftAnalyzer and add it here.
const analyzers: Record<string, LiftAnalyzer> = {
  squat: new SquatAnalyzer(),
};

export function getAnalyzer(liftType: string): LiftAnalyzer | null {
  return analyzers[liftType] ?? null;
}

export function listSupportedLifts(): string[] {
  return Object.keys(analyzers);
}
