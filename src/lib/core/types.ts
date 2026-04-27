// Core types for the lift analyzer pipeline.
// All geometry uses normalized coordinates [0,1] from MediaPipe (x=right, y=down).

export interface Keypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
  name: string;
}

export type KeypointName =
  | "nose" | "left_eye_inner" | "left_eye" | "left_eye_outer"
  | "right_eye_inner" | "right_eye" | "right_eye_outer"
  | "left_ear" | "right_ear"
  | "mouth_left" | "mouth_right"
  | "left_shoulder" | "right_shoulder"
  | "left_elbow" | "right_elbow"
  | "left_wrist" | "right_wrist"
  | "left_pinky" | "right_pinky"
  | "left_index" | "right_index"
  | "left_thumb" | "right_thumb"
  | "left_hip" | "right_hip"
  | "left_knee" | "right_knee"
  | "left_ankle" | "right_ankle"
  | "left_heel" | "right_heel"
  | "left_foot_index" | "right_foot_index";

export interface PoseFrame {
  timestamp: number;       // milliseconds from video start
  frameIndex: number;
  keypoints: Record<string, Keypoint>;
  confidence: number;      // mean visibility of key landmarks
}

export type RuleVerdict = "passed" | "borderline" | "failed" | "unknown";

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  verdict: RuleVerdict;
  value?: number;          // the measured geometric value
  threshold?: number;      // the threshold used
  cue: string;             // one-line coaching cue
  frameTimestamp?: number;
  confidence: number;      // 0-1 confidence in the measurement
}

// Config-driven rule: express simple comparisons without code
export interface GeometricRuleConfig {
  id: string;
  name: string;
  requiredKeypoints: string[];
  minVisibility: number;
  threshold: number;
  tolerance?: number;
  passedCue: string;
  failedCue: string;
  borderlineCue: string;
}

export interface RepMetrics {
  repNumber: number;
  startFrame: number;
  bottomFrame: number;
  endFrame: number;
  startTimestamp: number;
  bottomTimestamp: number;
  endTimestamp: number;
  descentDurationMs: number;
  ascentDurationMs: number;
  bottomDwellMs: number;
  ruleResults: RuleResult[];
  barPathDriftPercent: number;  // max X drift as % of torso length
  keyFrameDataUrl?: string;     // annotated bottom frame as data URL
}

export interface FormAnalysis {
  liftType: string;
  repCount: number;
  reps: RepMetrics[];
  overallVerdict: string;          // geometric summary sentence
  topFixes: TopFix[];
  videoValidation: VideoValidation;
  narrative?: string;              // LLM-generated coaching (may vary per run)
}

export interface TopFix {
  priority: number;
  ruleId: string;
  description: string;
  affectedReps: number[];
  cue: string;
}

export interface VideoValidation {
  valid: boolean;
  sideViewConfidence: number;
  personDetected: boolean;
  frameCount: number;
  durationMs: number;
  rejectionReason?: string;
}

// The interface every lift-specific analyzer must implement
export interface LiftAnalyzer {
  readonly liftType: string;

  /** Detect whether the video is plausibly this lift from sampled frames */
  validateVideo(frames: PoseFrame[]): VideoValidation;

  /** Split a pose sequence into individual reps, excluding walkout/rerack */
  segmentReps(frames: PoseFrame[]): Array<{ startFrame: number; bottomFrame: number; endFrame: number }>;

  /** Run all form checks on a single rep's pose sequence */
  analyzeRep(
    frames: PoseFrame[],
    repBounds: { startFrame: number; bottomFrame: number; endFrame: number },
    repNumber: number
  ): RepMetrics;

  /** Assemble full analysis from per-rep results */
  buildFormAnalysis(reps: RepMetrics[], validation: VideoValidation): FormAnalysis;
}

// Geometry helpers used across analyzers
export interface Point2D { x: number; y: number; }

export interface NarrativeRequest {
  liftType: string;
  repCount: number;
  overallVerdict: string;
  topFixes: TopFix[];
  reps: Array<{
    repNumber: number;
    descentDurationMs: number;
    ascentDurationMs: number;
    bottomDwellMs: number;
    barPathDriftPercent: number;
    ruleResults: Array<{ ruleId: string; verdict: RuleVerdict; value?: number }>;
  }>;
}
