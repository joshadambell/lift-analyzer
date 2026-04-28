import type { LiftAnalyzer } from "../core/types";
import { SquatAnalyzer } from "./squat/analyzer";
import { DeadliftAnalyzer } from "./deadlift/analyzer";
import { BenchPressAnalyzer } from "./bench/analyzer";
import { RDLAnalyzer } from "./rdl/analyzer";

const analyzers: Record<string, LiftAnalyzer> = {
  squat: new SquatAnalyzer(),
  deadlift: new DeadliftAnalyzer(),
  bench_press: new BenchPressAnalyzer(),
  romanian_deadlift: new RDLAnalyzer(),
};

export function getAnalyzer(liftType: string): LiftAnalyzer | null {
  return analyzers[liftType] ?? null;
}

export function listSupportedLifts(): string[] {
  return Object.keys(analyzers);
}
