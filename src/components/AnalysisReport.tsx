"use client";

import type { FormAnalysis } from "@/lib/core/types";
import { RepCard } from "./RepCard";

interface Props {
  analysis: FormAnalysis;
}

export function AnalysisReport({ analysis }: Props) {
  const { overallVerdict, topFixes, reps, narrative, videoValidation } = analysis;

  if (!videoValidation.valid) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-xl p-6">
        <div className="text-red-400 font-semibold mb-2">Analysis rejected</div>
        <div className="text-zinc-300 text-sm">{overallVerdict}</div>
        <div className="mt-4 text-xs text-zinc-500 font-mono">
          Frames analyzed: {videoValidation.frameCount} ·
          Duration: {(videoValidation.durationMs / 1000).toFixed(1)}s ·
          Side-view confidence: {(videoValidation.sideViewConfidence * 100).toFixed(0)}%
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Verdict */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6">
        <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Overall verdict</div>
        <div className="text-xl text-white font-semibold leading-snug">{overallVerdict}</div>

        {narrative && (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Coach&apos;s note</div>
            <div className="text-zinc-300 text-sm leading-relaxed">{narrative}</div>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-zinc-800 flex gap-6 text-xs text-zinc-500 font-mono">
          <span>{analysis.repCount} reps detected</span>
          <span>{videoValidation.frameCount} frames analyzed</span>
          <span>{(videoValidation.durationMs / 1000).toFixed(1)}s video</span>
        </div>
      </div>

      {/* Top 3 fixes */}
      {topFixes.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-3">
            Top fixes — prioritized
          </div>
          <div className="space-y-3">
            {topFixes.map((fix) => (
              <div
                key={fix.ruleId}
                className="flex gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4"
              >
                <div className="text-2xl font-bold text-zinc-600 w-8 shrink-0">{fix.priority}</div>
                <div>
                  <div className="text-sm font-medium text-zinc-300 mb-1">
                    Reps {fix.affectedReps.join(", ")}
                  </div>
                  <div className="text-sm text-zinc-400 leading-relaxed">{fix.cue}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-rep cards */}
      {reps.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-3">
            Per-rep breakdown
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reps.map((rep) => (
              <RepCard key={rep.repNumber} rep={rep} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
