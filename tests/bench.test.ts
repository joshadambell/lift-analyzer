import { describe, it, expect } from "vitest";
import { BenchPressAnalyzer } from "../src/lib/analyzers/bench/analyzer";
import { generateGoodBenchVideo, generateBounceBenchVideo } from "./fixtures/poseFixtures";

const analyzer = new BenchPressAnalyzer();

describe("Bench press video validation", () => {
  it("accepts a supine bench press video", () => {
    const frames = generateGoodBenchVideo();
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(true);
    expect(validation.personDetected).toBe(true);
  });

  it("rejects a video with too few frames", () => {
    const frames = generateGoodBenchVideo().slice(0, 5);
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionReason).toMatch(/too short/i);
  });
});

describe("Bench press rep segmentation", () => {
  it("detects at least one rep", () => {
    const frames = generateGoodBenchVideo();
    const reps = analyzer.segmentReps(frames);
    expect(reps.length).toBeGreaterThanOrEqual(1);
  });

  it("each rep has bottom frame between start and end", () => {
    const frames = generateGoodBenchVideo();
    const reps = analyzer.segmentReps(frames);
    for (const rep of reps) {
      expect(rep.bottomFrame).toBeGreaterThanOrEqual(rep.startFrame);
      expect(rep.bottomFrame).toBeLessThanOrEqual(rep.endFrame);
    }
  });
});

describe("Bench press pause detection", () => {
  it("passes pause for a rep with a solid chest pause (600ms)", () => {
    const frames = generateGoodBenchVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const pauseResult = rep.ruleResults.find((r) => r.ruleId === "pause");
    expect(pauseResult).toBeDefined();
    expect(["passed", "borderline"]).toContain(pauseResult?.verdict);
  });

  it("fails pause for a bounce rep (no dwell at chest)", () => {
    const frames = generateBounceBenchVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const pauseResult = rep.ruleResults.find((r) => r.ruleId === "pause");
    expect(pauseResult).toBeDefined();
    expect(["failed", "borderline"]).toContain(pauseResult?.verdict);
  });
});

describe("Bench press rule checks", () => {
  it("returns results for all four rules", () => {
    const frames = generateGoodBenchVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const ruleIds = rep.ruleResults.map((r) => r.ruleId);
    expect(ruleIds).toContain("pause");
    expect(ruleIds).toContain("softLockout");
    expect(ruleIds).toContain("buttLift");
    expect(ruleIds).toContain("barPath");
  });

  it("pause verdict is deterministic", () => {
    const frames = generateGoodBenchVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep1 = analyzer.analyzeRep(frames, repBounds[0], 1);
    const rep2 = analyzer.analyzeRep(frames, repBounds[0], 1);

    const p1 = rep1.ruleResults.find((r) => r.ruleId === "pause");
    const p2 = rep2.ruleResults.find((r) => r.ruleId === "pause");
    expect(p1?.verdict).toBe(p2?.verdict);
  });
});

describe("Bench press FormAnalysis assembly", () => {
  it("produces a valid FormAnalysis", () => {
    const frames = generateGoodBenchVideo();
    const validation = analyzer.validateVideo(frames);
    const repBounds = analyzer.segmentReps(frames);
    const reps = repBounds.map((b, i) => analyzer.analyzeRep(frames, b, i + 1));
    const analysis = analyzer.buildFormAnalysis(reps, validation);

    expect(analysis.liftType).toBe("bench_press");
    expect(analysis.repCount).toBeGreaterThan(0);
    expect(analysis.overallVerdict).toMatch(/rep/i);
  });
});
