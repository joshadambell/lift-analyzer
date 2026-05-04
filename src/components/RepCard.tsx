"use client";

import { useState } from "react";
import type { RepMetrics, RuleResult, RuleVerdict } from "@/lib/core/types";

interface Props {
  rep: RepMetrics;
  repScore?: number;
}

const VERDICT_COLOR: Record<RuleVerdict, string> = {
  passed: "text-green-400",
  borderline: "text-yellow-400",
  failed: "text-red-400",
  unknown: "text-zinc-500",
};

const VERDICT_BADGE: Record<RuleVerdict, string> = {
  passed: "bg-green-900/50 text-green-300 border border-green-700",
  borderline: "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
  failed: "bg-red-900/50 text-red-300 border border-red-700",
  unknown: "bg-zinc-800 text-zinc-400 border border-zinc-600",
};

function RuleRow({ rule }: { rule: RuleResult }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-zinc-800 last:border-0">
      <span className={`text-xs font-mono px-2 py-0.5 rounded whitespace-nowrap ${VERDICT_BADGE[rule.verdict]}`}>
        {rule.verdict}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-400 font-medium">{rule.ruleName}</div>
        <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{rule.cue}</div>
      </div>
      {rule.value !== undefined && (
        <div className="text-xs text-zinc-600 whitespace-nowrap">
          {rule.value.toFixed(1)}
        </div>
      )}
    </div>
  );
}

export function RepCard({ rep, repScore }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const depthRule = rep.ruleResults.find((r) => r.ruleId === "depth");
  const worstIssue = rep.ruleResults
    .filter((r) => r.verdict === "failed")
    .sort((a, b) => (a.confidence > b.confidence ? -1 : 1))[0];

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Key frame image */}
      {rep.keyFrameDataUrl && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rep.keyFrameDataUrl}
            alt={`Rep ${rep.repNumber} bottom position`}
            className="w-full object-cover max-h-64"
          />
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">Rep {rep.repNumber}</h3>
          <div className="flex items-center gap-2">
            {repScore !== undefined && (
              <span className="text-sm font-mono text-zinc-400">{repScore}/100</span>
            )}
            {depthRule && (
              <span className={`text-sm font-mono px-3 py-1 rounded-full ${VERDICT_BADGE[depthRule.verdict]}`}>
                Depth: {depthRule.verdict}
              </span>
            )}
          </div>
        </div>

        {/* Timing row */}
        <div className="flex gap-4 text-xs text-zinc-400 mb-4 font-mono">
          <span>↓ {(rep.descentDurationMs / 1000).toFixed(2)}s descent</span>
          <span>↑ {(rep.ascentDurationMs / 1000).toFixed(2)}s ascent</span>
          <span>⏸ {Math.round(rep.bottomDwellMs)}ms dwell</span>
          <span>→ {rep.barPathDriftPercent.toFixed(1)}% bar drift</span>
        </div>

        {/* Top issue */}
        {worstIssue && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mb-4">
            <div className="text-xs text-red-400 font-medium mb-1">Main issue: {worstIssue.ruleName}</div>
            <div className="text-xs text-zinc-300 leading-relaxed">{worstIssue.cue}</div>
          </div>
        )}

        {/* All rules */}
        <div className="mt-2">
          <div className="text-xs text-zinc-500 font-medium mb-2 uppercase tracking-wider">Form checks</div>
          {rep.ruleResults.map((rule) => (
            <RuleRow key={rule.ruleId} rule={rule} />
          ))}
        </div>

        {/* Raw data toggle */}
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {showRaw ? "Hide" : "Show"} raw data
        </button>

        {showRaw && (
          <pre className="mt-2 text-xs text-zinc-600 font-mono bg-zinc-950 rounded p-3 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(
              {
                timing: {
                  startTimestamp: rep.startTimestamp,
                  bottomTimestamp: rep.bottomTimestamp,
                  endTimestamp: rep.endTimestamp,
                },
                ruleResults: rep.ruleResults.map((r) => ({
                  id: r.ruleId,
                  verdict: r.verdict,
                  value: r.value,
                  threshold: r.threshold,
                  confidence: r.confidence,
                })),
              },
              null,
              2
            )}
          </pre>
        )}
      </div>
    </div>
  );
}
