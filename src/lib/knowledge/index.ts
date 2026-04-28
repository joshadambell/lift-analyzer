import liftsKb from "./lifts.json";

export type LiftKey = "squat" | "deadlift" | "bench_press" | "romanian_deadlift";

export interface KbCheckpoint {
  id: string;
  cue: string;
  standard?: string;
  high_bar?: string;
  low_bar?: string;
  competitive_note?: string;
  video_cues: string[];
}

export interface KbPhase {
  description: string;
  checkpoints: KbCheckpoint[];
}

export interface KbFault {
  id: string;
  fault: string;
  description: string;
  cause: string[];
  correction: string[];
  severity: "low" | "medium" | "high" | "high_for_competition";
  video_indicators: string[];
}

export interface KbBarPath {
  ideal: string;
  red_flags: string[];
}

export interface KbLift {
  name: string;
  variants: string[];
  context?: string;
  phases: Record<string, KbPhase>;
  common_faults: KbFault[];
  bar_path_analysis: KbBarPath;
}

export interface KbJointAngleRange {
  ideal_range_degrees: [number, number];
  measured?: string;
  note?: string;
}

const kb = liftsKb as unknown as {
  metadata: { lifts_covered: string[] };
  lifts: Record<LiftKey, KbLift>;
  video_analysis_framework: {
    joint_angles_to_track: Record<LiftKey, Record<string, KbJointAngleRange>>;
    key_frames_to_analyze: Record<LiftKey, string[]>;
  };
  competition_rules_reference: Record<string, string[]>;
};

export function getLift(lift: LiftKey): KbLift {
  return kb.lifts[lift];
}

export function getFault(lift: LiftKey, faultId: string): KbFault | undefined {
  return kb.lifts[lift].common_faults.find((f) => f.id === faultId);
}

export function getJointAngles(lift: LiftKey): Record<string, KbJointAngleRange> {
  return kb.video_analysis_framework.joint_angles_to_track[lift] ?? {};
}

export function listLifts(): LiftKey[] {
  return Object.keys(kb.lifts) as LiftKey[];
}

export function liftDisplayName(lift: LiftKey): string {
  return kb.lifts[lift].name;
}

/** Build a single-paragraph fault summary for the LLM coaching prompt. */
export function faultBriefForPrompt(lift: LiftKey, faultId: string): string {
  const f = getFault(lift, faultId);
  if (!f) return "";
  const corrections = f.correction.join(", ").replace(/_/g, " ");
  return `${f.fault} (${f.severity}): ${f.description}. Corrections: ${corrections}.`;
}

export const knowledgeBase = kb;
