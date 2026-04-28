import Anthropic from "@anthropic-ai/sdk";
import type { NarrativeRequest } from "@/lib/core/types";
import { getLift, type LiftKey, knowledgeBase } from "@/lib/knowledge";

const client = new Anthropic();

type LiftType = LiftKey | string;

const RULE_TO_FAULT: Record<string, Record<string, string>> = {
  squat: {
    depth: "sq_fault_4",
    kneeTravel: "sq_fault_1",
    hipShoot: "sq_fault_2",
    barPath: "sq_fault_5",
    buttWink: "sq_fault_3",
  },
  deadlift: {
    hipsShoot: "dl_fault_1",
    barDrift: "dl_fault_2",
    lumbarFlexion: "dl_fault_3",
    hyperextension: "dl_fault_4",
    hitching: "dl_fault_5",
  },
  bench_press: {
    elbowFlare: "bp_fault_1",
    bounce: "bp_fault_2",
    buttLift: "bp_fault_3",
    unevenBar: "bp_fault_4",
    softLockout: "bp_fault_5",
  },
  romanian_deadlift: {
    squatting: "rdl_fault_1",
    barDrift: "rdl_fault_2",
    forcingDepth: "rdl_fault_3",
    hyperextension: "rdl_fault_4",
  },
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as NarrativeRequest;
    const lift = body.liftType as LiftType;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: buildSystemPrompt(lift),
      messages: [{ role: "user", content: buildPrompt(body) }],
    });

    const narrative =
      message.content[0].type === "text" ? message.content[0].text : "";

    return Response.json({ narrative });
  } catch (error) {
    console.error("Narrative API error:", error);
    return Response.json({ narrative: null, error: "Narrative generation failed" }, { status: 500 });
  }
}

function buildSystemPrompt(lift: LiftType): string {
  const liftKey = lift as LiftKey;
  const kbLift = isKbLift(liftKey) ? getLift(liftKey) : null;
  const liftName = kbLift?.name ?? lift;

  return `You are a direct, technical strength coach reviewing a barbell ${liftName} video analysis.
You have been given geometric measurements produced by a deterministic pose-analysis pipeline.
Your role is to turn those numbers into a coach's voice: concise, actionable, no fluff.

Rules:
- Do not contradict the geometric verdicts (passed/failed are ground truth)
- Be direct. No "great job!" filler. No "it looks like..." hedging.
- Keep your response under 150 words
- Structure: one opening sentence with the verdict, then the top 1–2 things to fix
- Reference specific rep numbers when relevant
- Use the fault knowledge base provided in the user message when prescribing corrections — prefer those exact corrections over invented ones`;
}

function buildPrompt(req: NarrativeRequest): string {
  const lift = req.liftType as LiftType;
  const repSummaries = req.reps
    .map((r) => {
      const ruleSummary = r.ruleResults
        .map((rr) => `${rr.ruleId}=${rr.verdict}`)
        .join(",");
      return `  Rep ${r.repNumber}: descent=${r.descentDurationMs}ms ascent=${r.ascentDurationMs}ms dwell=${r.bottomDwellMs}ms drift=${r.barPathDriftPercent.toFixed(1)}% [${ruleSummary}]`;
    })
    .join("\n");

  const fixes = req.topFixes
    .map((f) => `  ${f.priority}. ${f.ruleId} (reps ${f.affectedReps.join(",")}): ${f.cue}`)
    .join("\n");

  const kbContext = buildKbContext(lift, req.topFixes.map((f) => f.ruleId));

  return `Lift: ${lift}
Overall verdict: ${req.overallVerdict}
Total reps: ${req.repCount}

Per-rep data:
${repSummaries}

Top issues identified by deterministic checks:
${fixes}
${kbContext ? `\nRelevant fault knowledge (use the listed corrections in your coaching):\n${kbContext}\n` : ""}
Write your coaching response now.`;
}

function buildKbContext(lift: LiftType, ruleIds: string[]): string {
  const liftKey = lift as LiftKey;
  if (!isKbLift(liftKey)) return "";

  const ruleMap = RULE_TO_FAULT[liftKey] ?? {};
  const lines: string[] = [];
  for (const ruleId of ruleIds) {
    const faultId = ruleMap[ruleId];
    if (!faultId) continue;
    const fault = knowledgeBase.lifts[liftKey].common_faults.find((f) => f.id === faultId);
    if (!fault) continue;
    const corrections = fault.correction.map((c) => c.replace(/_/g, " ")).join(", ");
    lines.push(`  - ${fault.fault}: ${fault.description}. Corrections: ${corrections}.`);
  }
  return lines.join("\n");
}

function isKbLift(lift: string): lift is LiftKey {
  return lift in knowledgeBase.lifts;
}
