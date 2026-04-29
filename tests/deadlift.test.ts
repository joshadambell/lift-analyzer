import { describe, it, expect } from "vitest";
import { DeadliftAnalyzer } from "../src/lib/analyzers/deadlift/analyzer";
import { generateGoodDeadliftVideo } from "./fixtures/poseFixtures";

const analyzer = new DeadliftAnalyzer();

describe("Deadlift video validation", () => {
  it("accepts a valid deadlift video", () => {
    const frames = generateGoodDeadliftVideo();
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(true);
    expect(validation.personDetected).toBe(true);
  });

  it("rejects a video with too few frames", () => {
    const frames = generateGoodDeadliftVideo().slice(0, 5);
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionReason).toMatch(/too short/i);
  });
});

describe("Deadlift rep segmentation", () => {
  it("detects at least one rep", () => {
    const frames = generateGoodDeadliftVideo();
    const reps = analyzer.segmentReps(frames);
    expect(reps.length).toBeGreaterThanOrEqual(1);
  });

  it("each rep has a valid bottom (lockout) frame between start and end", () => {
    const frames = generateGoodDeadliftVideo();
    const reps = analyzer.segmentReps(frames);
    for (const rep of reps) {
      expect(rep.bottomFrame).toBeGreaterThanOrEqual(rep.startFrame);
      expect(rep.bottomFrame).toBeLessThanOrEqual(rep.endFrame);
    }
  });
});

describe("Deadlift rule checks", () => {
  it("returns results for all four rules", () => {
    const frames = generateGoodDeadliftVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const ruleIds = rep.ruleResults.map((r) => r.ruleId);
    expect(ruleIds).toContain("hipsShoot");
    expect(ruleIds).toContain("barDrift");
    expect(ruleIds).toContain("hyperextension");
    expect(ruleIds).toContain("hitching");
  });

  it("clean pull has no failed rules (passed or unknown)", () => {
    const frames = generateGoodDeadliftVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);

    const failed = rep.ruleResults.filter((r) => r.verdict === "failed");
    expect(failed).toHaveLength(0);
  });

  it("rule results are deterministic", () => {
    const frames = generateGoodDeadliftVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep1 = analyzer.analyzeRep(frames, repBounds[0], 1);
    const rep2 = analyzer.analyzeRep(frames, repBounds[0], 1);

    for (const rule of rep1.ruleResults) {
      const match = rep2.ruleResults.find((r) => r.ruleId === rule.ruleId);
      expect(match?.verdict).toBe(rule.verdict);
    }
  });
});

describe("Deadlift FormAnalysis assembly", () => {
  it("produces a valid FormAnalysis", () => {
    const frames = generateGoodDeadliftVideo();
    const validation = analyzer.validateVideo(frames);
    const repBounds = analyzer.segmentReps(frames);
    const reps = repBounds.map((b, i) => analyzer.analyzeRep(frames, b, i + 1));
    const analysis = analyzer.buildFormAnalysis(reps, validation);

    expect(analysis.liftType).toBe("deadlift");
    expect(analysis.repCount).toBeGreaterThan(0);
    expect(analysis.overallVerdict).toBeTruthy();
  });
});
