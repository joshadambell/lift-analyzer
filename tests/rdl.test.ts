import { describe, it, expect } from "vitest";
import { RDLAnalyzer } from "../src/lib/analyzers/rdl/analyzer";
import { generateGoodRdlVideo } from "./fixtures/poseFixtures";

const analyzer = new RDLAnalyzer();

describe("RDL video validation", () => {
  it("accepts a valid RDL video", () => {
    const frames = generateGoodRdlVideo();
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(true);
    expect(validation.personDetected).toBe(true);
  });

  it("rejects a video with too few frames", () => {
    const frames = generateGoodRdlVideo().slice(0, 5);
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionReason).toMatch(/too short/i);
  });
});

describe("RDL rep segmentation", () => {
  it("detects at least one rep", () => {
    const frames = generateGoodRdlVideo();
    const reps = analyzer.segmentReps(frames);
    expect(reps.length).toBeGreaterThanOrEqual(1);
  });

  it("each rep has bottom frame between start and end", () => {
    const frames = generateGoodRdlVideo();
    const reps = analyzer.segmentReps(frames);
    for (const rep of reps) {
      expect(rep.bottomFrame).toBeGreaterThanOrEqual(rep.startFrame);
      expect(rep.bottomFrame).toBeLessThanOrEqual(rep.endFrame);
    }
  });
});

describe("RDL knee constancy check", () => {
  it("passes squattingRDL for a clean hinge pattern (knees stay constant)", () => {
    const frames = generateGoodRdlVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const kneeResult = rep.ruleResults.find((r) => r.ruleId === "squattingRDL");
    expect(kneeResult).toBeDefined();
    expect(["passed", "borderline"]).toContain(kneeResult?.verdict);
  });
});

describe("RDL rule checks", () => {
  it("returns results for all three rules", () => {
    const frames = generateGoodRdlVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const ruleIds = rep.ruleResults.map((r) => r.ruleId);
    expect(ruleIds).toContain("squattingRDL");
    expect(ruleIds).toContain("barDrift");
    expect(ruleIds).toContain("hyperextension");
  });

  it("clean RDL has no failed rules (passed, borderline, or unknown)", () => {
    const frames = generateGoodRdlVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);

    const failed = rep.ruleResults.filter((r) => r.verdict === "failed");
    expect(failed).toHaveLength(0);
  });

  it("rule results are deterministic", () => {
    const frames = generateGoodRdlVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep1 = analyzer.analyzeRep(frames, repBounds[0], 1);
    const rep2 = analyzer.analyzeRep(frames, repBounds[0], 1);

    for (const rule of rep1.ruleResults) {
      const match = rep2.ruleResults.find((r) => r.ruleId === rule.ruleId);
      expect(match?.verdict).toBe(rule.verdict);
    }
  });
});

describe("RDL FormAnalysis assembly", () => {
  it("produces a valid FormAnalysis", () => {
    const frames = generateGoodRdlVideo();
    const validation = analyzer.validateVideo(frames);
    const repBounds = analyzer.segmentReps(frames);
    const reps = repBounds.map((b, i) => analyzer.analyzeRep(frames, b, i + 1));
    const analysis = analyzer.buildFormAnalysis(reps, validation);

    expect(analysis.liftType).toBe("romanian_deadlift");
    expect(analysis.repCount).toBeGreaterThan(0);
    expect(analysis.overallVerdict).toBeTruthy();
  });
});
