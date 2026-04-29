"use client";

import type { FormAnalysis } from "@/lib/core/types";
import type { LiftScore } from "@/lib/core/scoring";
import { RepCard } from "./RepCard";

interface Props {
  analysis: FormAnalysis;
}

const GRADE_STYLES: Record<LiftScore["grade"], { ring: string; text: string; label: string }> = {
  A: { ring: "border-green-500",   text: "text-green-400",  label: "Excellent" },
  B: { ring: "border-emerald-500", text: "text-emerald-400", label: "Good" },
  C: { ring: "border-yellow-500",  text: "text-yellow-400", label: "Fair" },
  D: { ring: "border-orange-500",  text: "text-orange-400", label: "Needs work" },
  F: { ring: "border-red-500",     text: "text-red-400",    label: "Major issues" },
};

function ScoreBadge({ score }: { score: LiftScore }) {
  const s = GRADE_STYLES[score.grade];
  return (
    <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-full border-4 shrink-0 ${s.ring}`}>
      <span className={`text-2xl font-black leading-none ${s.text}`}>{score.score}</span>
      <span className={`text-xs font-bold ${s.text}`}>{score.grade}</span>
    </div>
  );
}

export function AnalysisReport({ analysis }: Props) {
  const { overallVerdict, topFixes, reps, narrative, videoValidation, score } = analysis;

  if (!videoValidation.valid) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-xl p-6">
        <div className="text-red-400 font-semibold mb-2">Analysis failed</div>
        <div className="text-zinc-300 text-sm">{overallVerdict}</div>
        <div className="mt-4 text-xs text-zinc-500 font-mono">
          Frames analyzed: {videoValidation.frameCount} ·
          Duration: {(videoValidation.durationMs / 1000).toFixed(1)}s
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Angle warning (non-blocking) */}
      {videoValidation.rejectionReason && (
        <div className="bg-yellow-950/30 border border-yellow-800/50 rounded-xl px-4 py-3 text-xs text-yellow-400">
          ⚠ {videoValidation.rejectionReason}
        </div>
      )}

      {/* Score + Verdict */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6">
        <div className="flex gap-5 items-start">
          <ScoreBadge score={score} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-sm font-semibold ${GRADE_STYLES[score.grade].text}`}>
                {GRADE_STYLES[score.grade].label}
              </span>
              {score.repScores.length > 1 && (
                <span className="text-xs text-zinc-500 font-mono">
                  reps: {score.repScores.join(" · ")}
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-1">Overall verdict</div>
            <div className="text-base text-white font-semibold leading-snug">{overallVerdict}</div>
          </div>
        </div>

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
            {reps.map((rep, i) => (
              <RepCard key={rep.repNumber} rep={rep} repScore={score.repScores[i]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
