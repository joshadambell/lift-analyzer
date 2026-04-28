"use client";

import { useState, useCallback } from "react";
import { VideoUpload } from "@/components/VideoUpload";
import { AnalysisReport } from "@/components/AnalysisReport";
import type { FormAnalysis } from "@/lib/core/types";
import type { AnalysisProgress } from "@/lib/core/orchestrator";
import { listLifts, liftDisplayName, type LiftKey } from "@/lib/knowledge";

const LIFTS: LiftKey[] = listLifts();

export default function HomePage() {
  const [lift, setLift] = useState<LiftKey>("squat");
  const [analysis, setAnalysis] = useState<FormAnalysis | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVideoSelected = useCallback(async (file: File) => {
    setAnalysis(null);
    setError(null);
    setProgress({ stage: "extracting", pct: 0, message: "Loading…" });

    try {
      const { runAnalysis } = await import("@/lib/core/orchestrator");
      const result = await runAnalysis(file, lift, setProgress);
      setAnalysis(result);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
      setProgress(null);
    }
  }, [lift]);

  const reset = useCallback(() => {
    setAnalysis(null);
    setProgress(null);
    setError(null);
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Lift Form Analyzer
          </h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Side-view video form analysis · Squat · Deadlift · Bench · RDL
          </p>
        </div>

        {!progress && !analysis && (
          <div className="space-y-6">
            <div>
              <label className="text-xs text-zinc-400 uppercase tracking-wider mb-3 block">
                Select lift
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {LIFTS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLift(l)}
                    className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors border ${
                      lift === l
                        ? "bg-green-600 text-white border-green-500"
                        : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    {liftDisplayName(l)}
                  </button>
                ))}
              </div>
            </div>
            <VideoUpload onVideoSelected={handleVideoSelected} liftName={liftDisplayName(lift)} />
          </div>
        )}

        {progress && (
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between text-sm mb-3">
                <span className="text-zinc-300">{progress.message}</span>
                <span className="text-zinc-500 font-mono">{progress.pct.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-zinc-600 text-center">
              First run downloads the MediaPipe model (~5MB) — subsequent runs are faster.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-800 rounded-xl p-6">
            <div className="text-red-400 font-semibold mb-2">Error</div>
            <div className="text-zinc-300 text-sm">{error}</div>
            <button
              onClick={reset}
              className="mt-4 text-xs text-zinc-400 hover:text-white transition-colors underline"
            >
              Try another video
            </button>
          </div>
        )}

        {analysis && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">
                {liftDisplayName(analysis.liftType as LiftKey)} Analysis
              </h2>
              <button
                onClick={reset}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                ← Analyze another video
              </button>
            </div>
            <AnalysisReport analysis={analysis} />
          </div>
        )}
      </div>
    </main>
  );
}
