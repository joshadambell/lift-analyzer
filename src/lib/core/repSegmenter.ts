import type { PoseFrame } from "./types";
import { getKp, smoothMovingAverage, midpoint } from "./geometry";

export interface RepBounds {
  startFrame: number;
  bottomFrame: number;
  endFrame: number;
}

/**
 * Per-frame primary-signal extractor. Returns the Y value to track, or -1 if
 * the keypoint isn't visible enough to use (will be filled by interpolation).
 *
 * Convention used by the FSM below: larger value = "deeper into the rep"
 * (further from the standing/start position). For lifts that start at the
 * top (squat, bench, RDL), use raw hip-Y or wrist-Y. For lifts that start
 * at the bottom (deadlift), negate the Y so liftoff registers as descent.
 */
export type SignalExtractor = (frame: PoseFrame) => number;

export interface SegmentOptions {
  smoothingWindow?: number;
  /** Min depth change to count as a real rep (filters walkout/setup noise) */
  minDepthThreshold?: number;
  bottomWindowFrames?: number;
  minRepFrames?: number;
  /** Override the default hip-midpoint signal extractor */
  signal?: SignalExtractor;
  /**
   * Fraction of minDepthThreshold the signal must have returned from its peak
   * before a rep counts. Higher = stricter. Default 0.25 (permissive).
   * Set higher for lifts where post-set stand-up creates false reps (deadlift).
   */
  returnDepthFraction?: number;
}

/** Missing-frame sentinel — any extractor that can't read its keypoint returns NaN. */
const MISSING = NaN;

export const hipYSignal: SignalExtractor = (f) => {
  const lh = getKp(f, "left_hip");
  const rh = getKp(f, "right_hip");
  if (lh && rh) return midpoint(lh, rh).y;
  if (lh) return lh.y;
  if (rh) return rh.y;
  return MISSING;
};

/**
 * Wrist-Y for bench: bar tracks with hands, descends toward chest.
 * Same direction convention as hip-Y for squat (down = larger Y).
 */
export const wristYSignal: SignalExtractor = (f) => {
  const lw = getKp(f, "left_wrist");
  const rw = getKp(f, "right_wrist");
  if (lw && rw) return midpoint(lw, rw).y;
  if (lw) return lw.y;
  if (rw) return rw.y;
  return MISSING;
};

/**
 * Inverted wrist-Y for deadlift: lift starts on floor (large Y) and the
 * "rep peak" is at standing (small Y). Negating flips the trajectory into
 * the same up→down→up shape the FSM expects.
 */
export const invertedWristYSignal: SignalExtractor = (f) => {
  const v = wristYSignal(f);
  return Number.isNaN(v) ? MISSING : -v;
};

/**
 * Rep segmentation FSM driven by a configurable primary signal.
 *
 * The signal must follow the convention: larger value = deeper into rep.
 * The FSM walks: standing → descending → bottom → ascending → standing.
 */
export function segmentReps(
  frames: PoseFrame[],
  options: SegmentOptions = {}
): RepBounds[] {
  const {
    smoothingWindow = 7,
    minDepthThreshold = 0.08,
    minRepFrames = 15,
    signal = hipYSignal,
    returnDepthFraction = 0.25,
  } = options;
  const minReturnDepth = minDepthThreshold * returnDepthFraction;

  if (frames.length < minRepFrames) return [];

  const raw = frames.map(signal);
  const filled = fillMissing(raw);
  const smoothed = smoothMovingAverage(filled, smoothingWindow);

  const reps: RepBounds[] = [];
  let state: "standing" | "descending" | "bottom" | "ascending" = "standing";
  let repStart = 0;
  let bottomFrame = 0;
  let bottomY = smoothed[0];

  // Hysteresis must be smaller than the per-frame change after smoothing.
  const HYSTERESIS = 0.004;

  for (let i = 1; i < smoothed.length; i++) {
    const dy = smoothed[i] - smoothed[i - 1];

    switch (state) {
      case "standing": {
        if (dy > 0.001) {
          state = "descending";
          repStart = i - 1;
          bottomY = smoothed[i];
        }
        break;
      }
      case "descending": {
        if (smoothed[i] > bottomY) {
          bottomY = smoothed[i];
          bottomFrame = i;
        }
        if (dy < -HYSTERESIS) {
          state = "bottom";
        }
        break;
      }
      case "bottom": {
        if (dy < -HYSTERESIS) {
          state = "ascending";
        }
        break;
      }
      case "ascending": {
        if (dy > HYSTERESIS) {
          const repEnd = i;
          const totalFrames = repEnd - repStart;
          const depthChange = smoothed[bottomFrame] - smoothed[repStart];
          // Require the signal to have returned at least halfway from its peak.
          // This rejects false "stand up after set" reps where the signal peaks
          // (at lockout) and then barely moves before the FSM resets.
          const returnDepth = smoothed[bottomFrame] - smoothed[repEnd];

          if (totalFrames >= minRepFrames && depthChange >= minDepthThreshold && returnDepth >= minReturnDepth) {
            reps.push({ startFrame: repStart, bottomFrame, endFrame: repEnd });
          }

          state = "standing";
          repStart = i;
          bottomY = smoothed[i];
        }
        break;
      }
    }
  }

  if (state === "ascending") {
    const repEnd = smoothed.length - 1;
    const totalFrames = repEnd - repStart;
    const depthChange = smoothed[bottomFrame] - smoothed[repStart];
    const returnDepth = smoothed[bottomFrame] - smoothed[repEnd];
    if (totalFrames >= minRepFrames && depthChange >= minDepthThreshold && returnDepth >= minReturnDepth) {
      reps.push({ startFrame: repStart, bottomFrame, endFrame: repEnd });
    }
  }

  return reps;
}

function fillMissing(values: number[]): number[] {
  const result = [...values];
  let last = values.find((v) => !Number.isNaN(v)) ?? 0.5;
  for (let i = 0; i < result.length; i++) {
    if (Number.isNaN(result[i])) result[i] = last;
    else last = result[i];
  }
  return result;
}
