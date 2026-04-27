import Anthropic from "@anthropic-ai/sdk";
import type { NarrativeRequest } from "@/lib/core/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as NarrativeRequest;

    const prompt = buildPrompt(body);

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: `You are a direct, technical strength coach reviewing a barbell squat video analysis.
You have been given geometric measurements — depth verdicts, bar path drift, knee travel, tempo data — produced by a deterministic pose analysis pipeline.
Your role is to turn those numbers into a coach's voice: concise, actionable, no fluff.

Rules:
- Do not contradict the geometric verdicts (depth pass/fail is ground truth)
- Be direct. No "great job!" filler. No "it looks like..." hedging.
- Keep your response under 150 words
- Structure: one opening sentence with the verdict, then the top 1-2 things to fix
- Reference specific rep numbers when relevant`,
      messages: [{ role: "user", content: prompt }],
    });

    const narrative =
      message.content[0].type === "text" ? message.content[0].text : "";

    return Response.json({ narrative });
  } catch (error) {
    console.error("Narrative API error:", error);
    return Response.json({ narrative: null, error: "Narrative generation failed" }, { status: 500 });
  }
}

function buildPrompt(req: NarrativeRequest): string {
  const repSummaries = req.reps.map((r) => {
    const depthResult = r.ruleResults.find((rr) => rr.ruleId === "depth");
    const kneeResult = r.ruleResults.find((rr) => rr.ruleId === "kneeTravel");
    const hipResult = r.ruleResults.find((rr) => rr.ruleId === "hipShoot");
    const barResult = r.ruleResults.find((rr) => rr.ruleId === "barPath");

    return `  Rep ${r.repNumber}: depth=${depthResult?.verdict ?? "?"}` +
      ` | descent=${r.descentDurationMs}ms | ascent=${r.ascentDurationMs}ms` +
      ` | bottom_dwell=${r.bottomDwellMs}ms | bar_drift=${r.barPathDriftPercent.toFixed(1)}%` +
      ` | knee_travel=${kneeResult?.verdict ?? "?"} | hip_shoot=${hipResult?.verdict ?? "?"}`;
  }).join("\n");

  const fixes = req.topFixes
    .map((f) => `  ${f.priority}. ${f.ruleId} (reps ${f.affectedReps.join(",")}): ${f.cue}`)
    .join("\n");

  return `Lift: barbell back squat
Overall verdict: ${req.overallVerdict}
Total reps: ${req.repCount}

Per-rep data:
${repSummaries}

Top issues identified:
${fixes}

Write your coaching response now.`;
}
