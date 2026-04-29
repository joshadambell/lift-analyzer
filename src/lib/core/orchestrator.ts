"use client";

import type { FormAnalysis, PoseFrame, RepMetrics, NarrativeRequest } from "./types";
import { extractPosesFromVideo, extractFrameBitmap } from "./poseExtractor";
import { renderRepKeyFrame } from "./reportRenderer";
import { getAnalyzer } from "../analyzers";

export interface AnalysisProgress {
  stage: "extracting" | "segmenting" | "analyzing" | "rendering" | "narrative" | "done" | "error";
  pct: number;
  message: string;
}

export async function runAnalysis(
  videoFile: File,
  liftType: string,
  onProgress: (p: AnalysisProgress) => void
): Promise<FormAnalysis> {
  const analyzer = getAnalyzer(liftType);
  if (!analyzer) throw new Error(`No analyzer for lift type: ${liftType}`);

  // Stage 1: Extract poses
  onProgress({ stage: "extracting", pct: 0, message: "Extracting pose data from video…" });
  const frames = await extractPosesFromVideo(videoFile, (pct) => {
    onProgress({ stage: "extracting", pct: pct * 0.5, message: `Extracting poses… ${pct.toFixed(0)}%` });
  });

  // Stage 2: Validate + segment
  onProgress({ stage: "segmenting", pct: 52, message: "Validating camera angle and detecting reps…" });
  const validation = analyzer.validateVideo(frames);
  if (!validation.valid) {
    return {
      liftType,
      repCount: 0,
      reps: [],
      overallVerdict: validation.rejectionReason ?? "Analysis failed",
      topFixes: [],
      videoValidation: validation,
      score: { score: 0, grade: "F" as const, repScores: [] },
    };
  }

  const repBounds = analyzer.segmentReps(frames);
  if (!repBounds.length) {
    return {
      liftType,
      repCount: 0,
      reps: [],
      overallVerdict: "No reps detected. Ensure the video shows complete reps with the lifter clearly in frame.",
      topFixes: [],
      videoValidation: { ...validation, rejectionReason: "No reps detected" },
      score: { score: 0, grade: "F" as const, repScores: [] },
    };
  }

  // Stage 3: Analyze each rep
  onProgress({ stage: "analyzing", pct: 60, message: `Analyzing ${repBounds.length} rep(s)…` });
  const repMetrics: RepMetrics[] = repBounds.map((bounds, i) =>
    analyzer.analyzeRep(frames, bounds, i + 1)
  );

  // Stage 4: Render key frames
  onProgress({ stage: "rendering", pct: 75, message: "Rendering annotated key frames…" });
  for (let i = 0; i < repMetrics.length; i++) {
    const rep = repMetrics[i];
    const repFrames = frames.slice(repBounds[i].startFrame, repBounds[i].endFrame + 1);
    try {
      rep.keyFrameDataUrl = await renderRepKeyFrame(videoFile, rep, frames, repFrames);
    } catch {
      // Non-fatal: continue without key frame
    }
    onProgress({
      stage: "rendering",
      pct: 75 + ((i + 1) / repMetrics.length) * 15,
      message: `Rendered key frame ${i + 1}/${repMetrics.length}`,
    });
  }

  // Stage 5: Build analysis
  const analysis = analyzer.buildFormAnalysis(repMetrics, validation);

  // Stage 6: Request narrative from Claude
  onProgress({ stage: "narrative", pct: 92, message: "Generating coaching feedback…" });
  try {
    const narrativeReq: NarrativeRequest = {
      liftType: analysis.liftType,
      repCount: analysis.repCount,
      overallVerdict: analysis.overallVerdict,
      topFixes: analysis.topFixes,
      reps: analysis.reps.map((r) => ({
        repNumber: r.repNumber,
        descentDurationMs: r.descentDurationMs,
        ascentDurationMs: r.ascentDurationMs,
        bottomDwellMs: r.bottomDwellMs,
        barPathDriftPercent: r.barPathDriftPercent,
        ruleResults: r.ruleResults.map((rr) => ({
          ruleId: rr.ruleId,
          verdict: rr.verdict,
          value: rr.value,
        })),
      })),
    };

    const res = await fetch("/api/narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(narrativeReq),
    });
    if (res.ok) {
      const { narrative } = await res.json();
      analysis.narrative = narrative;
    }
  } catch {
    // Non-fatal: narrative is optional
  }

  onProgress({ stage: "done", pct: 100, message: "Analysis complete." });
  return analysis;
}
