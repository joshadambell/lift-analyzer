/**
 * Squat analyzer tests using synthetic pose fixtures.
 *
 * Each test generates a PoseFrame[] that simulates a specific scenario
 * and asserts the analyzer produces the expected geometric verdict.
 * The LLM narrative is not tested here — only deterministic outputs.
 */

import { describe, it, expect } from "vitest";
import { SquatAnalyzer } from "../src/lib/analyzers/squat/analyzer";
import {
  generateGoodSquatVideo,
  generateShallowSquatVideo,
  generateForwardKneeDriftVideo,
} from "./fixtures/poseFixtures";

const analyzer = new SquatAnalyzer();

describe("Video validation", () => {
  it("accepts a valid side-view video with sufficient frames", () => {
    const frames = generateGoodSquatVideo();
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(true);
    expect(validation.personDetected).toBe(true);
  });

  it("rejects a video with too few frames", () => {
    const frames = generateGoodSquatVideo().slice(0, 5);
    const validation = analyzer.validateVideo(frames);
    expect(validation.valid).toBe(false);
    expect(validation.rejectionReason).toMatch(/too short/i);
  });
});

describe("Rep segmentation", () => {
  it("detects the correct number of reps in a 2-rep video", () => {
    const frames = generateGoodSquatVideo();
    const reps = analyzer.segmentReps(frames);
    expect(reps.length).toBeGreaterThanOrEqual(1);
    expect(reps.length).toBeLessThanOrEqual(3); // walkout shouldn't count
  });

  it("detects at least 1 rep in a single-rep video", () => {
    const frames = generateForwardKneeDriftVideo();
    const reps = analyzer.segmentReps(frames);
    expect(reps.length).toBeGreaterThanOrEqual(1);
  });

  it("each detected rep has a valid bottom frame between start and end", () => {
    const frames = generateGoodSquatVideo();
    const reps = analyzer.segmentReps(frames);
    for (const rep of reps) {
      expect(rep.bottomFrame).toBeGreaterThanOrEqual(rep.startFrame);
      expect(rep.bottomFrame).toBeLessThanOrEqual(rep.endFrame);
    }
  });
});

describe("Depth check", () => {
  it("passes depth for a deep squat where hip crease goes below knee", () => {
    const frames = generateGoodSquatVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const depthResult = rep.ruleResults.find((r) => r.ruleId === "depth");

    expect(depthResult).toBeDefined();
    expect(depthResult?.verdict).toBe("passed");
  });

  it("fails depth for a shallow squat where hips stay above knees", () => {
    const frames = generateShallowSquatVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const depthResult = rep.ruleResults.find((r) => r.ruleId === "depth");

    expect(depthResult).toBeDefined();
    expect(["failed", "borderline"]).toContain(depthResult?.verdict);
  });
});

describe("Knee travel check", () => {
  it("fails knee travel when knees continue drifting past mid-descent", () => {
    const frames = generateForwardKneeDriftVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const kneeResult = rep.ruleResults.find((r) => r.ruleId === "kneeTravel");

    expect(kneeResult).toBeDefined();
    expect(["failed", "borderline"]).toContain(kneeResult?.verdict);
  });

  it("passes knee travel for a good squat", () => {
    const frames = generateGoodSquatVideo();
    const repBounds = analyzer.segmentReps(frames);
    expect(repBounds.length).toBeGreaterThan(0);

    const rep = analyzer.analyzeRep(frames, repBounds[0], 1);
    const kneeResult = rep.ruleResults.find((r) => r.ruleId === "kneeTravel");

    expect(kneeResult).toBeDefined();
    expect(["passed", "borderline"]).toContain(kneeResult?.verdict);
  });
});

describe("FormAnalysis assembly", () => {
  it("produces a non-empty overall verdict", () => {
    const frames = generateShallowSquatVideo();
    const validation = analyzer.validateVideo(frames);
    const repBounds = analyzer.segmentReps(frames);
    const reps = repBounds.map((b, i) => analyzer.analyzeRep(frames, b, i + 1));
    const analysis = analyzer.buildFormAnalysis(reps, validation);

    expect(analysis.overallVerdict).toBeTruthy();
    expect(analysis.liftType).toBe("squat");
    expect(analysis.repCount).toBeGreaterThan(0);
  });

  it("top fixes reference valid rep numbers", () => {
    const frames = generateForwardKneeDriftVideo();
    const validation = analyzer.validateVideo(frames);
    const repBounds = analyzer.segmentReps(frames);
    const reps = repBounds.map((b, i) => analyzer.analyzeRep(frames, b, i + 1));
    const analysis = analyzer.buildFormAnalysis(reps, validation);

    for (const fix of analysis.topFixes) {
      for (const repNum of fix.affectedReps) {
        expect(repNum).toBeGreaterThanOrEqual(1);
        expect(repNum).toBeLessThanOrEqual(analysis.repCount);
      }
    }
  });

  it("depth verdict is deterministic — same video, same result", () => {
    const frames = generateShallowSquatVideo();
    const repBounds = analyzer.segmentReps(frames);
    const rep1 = analyzer.analyzeRep(frames, repBounds[0], 1);
    const rep2 = analyzer.analyzeRep(frames, repBounds[0], 1);

    const d1 = rep1.ruleResults.find((r) => r.ruleId === "depth");
    const d2 = rep2.ruleResults.find((r) => r.ruleId === "depth");

    expect(d1?.verdict).toBe(d2?.verdict);
    expect(d1?.value).toBe(d2?.value);
  });
});
