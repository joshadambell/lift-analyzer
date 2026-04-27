import type { PoseFrame } from "./types";
import { getKp, smoothMovingAverage, midpoint } from "./geometry";

export interface RepBounds {
  startFrame: number;
  bottomFrame: number;
  endFrame: number;
}

interface SegmentOptions {
  smoothingWindow?: number;
  // Minimum hip Y change to count as a descent (as fraction of frame height)
  minDepthThreshold?: number;
  // How many frames of "plateau" to consider the bottom reached
  bottomWindowFrames?: number;
  // Minimum frames a rep must span to be valid (filters out noise)
  minRepFrames?: number;
}

/**
 * Rep segmentation based on hip-midpoint Y trajectory.
 *
 * In MediaPipe normalized coords, Y increases downward, so a descent means
 * hip Y is *increasing* (hips moving toward floor).
 *
 * Strategy:
 *   1. Extract hip Y values across all frames.
 *   2. Smooth with moving average to remove keypoint jitter.
 *   3. Find local maxima (standing) and local minima (bottom).
 *   4. Pair each max→min→max as one rep.
 *   5. Filter by minimum depth change to exclude walkout steps.
 */
export function segmentReps(
  frames: PoseFrame[],
  options: SegmentOptions = {}
): RepBounds[] {
  const {
    smoothingWindow = 7,
    minDepthThreshold = 0.08,
    bottomWindowFrames = 3,
    minRepFrames = 15,
  } = options;

  if (frames.length < minRepFrames) return [];

  // Extract hip midpoint Y per frame
  const hipY = frames.map((f) => {
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    if (lh && rh) return midpoint(lh, rh).y;
    if (lh) return lh.y;
    if (rh) return rh.y;
    return -1; // missing
  });

  // Interpolate missing values linearly
  const filled = fillMissing(hipY);
  const smoothed = smoothMovingAverage(filled, smoothingWindow);

  // Find descent/ascent transitions using a finite state machine
  const reps: RepBounds[] = [];
  let state: "standing" | "descending" | "bottom" | "ascending" = "standing";
  let repStart = 0;
  let bottomFrame = 0;
  let bottomY = smoothed[0];

  const HYSTERESIS = 0.02; // prevents jitter-triggered transitions

  for (let i = 1; i < smoothed.length; i++) {
    const dy = smoothed[i] - smoothed[i - 1]; // positive = moving down

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
        // Transition to bottom when movement reverses
        if (dy < -HYSTERESIS) {
          state = "bottom";
        }
        break;
      }
      case "bottom": {
        // Linger here until we confirm ascent is real
        if (dy > HYSTERESIS) {
          state = "ascending";
        }
        break;
      }
      case "ascending": {
        if (dy < -HYSTERESIS) {
          // Rep complete: hips back at top
          const repEnd = i;
          const totalFrames = repEnd - repStart;
          const depthChange = smoothed[bottomFrame] - smoothed[repStart];

          if (totalFrames >= minRepFrames && depthChange >= minDepthThreshold) {
            reps.push({ startFrame: repStart, bottomFrame, endFrame: repEnd });
          }

          // Start looking for the next rep from current position
          state = "standing";
          repStart = i;
          bottomY = smoothed[i];
        } else if (smoothed[i] > smoothed[bottomFrame] + HYSTERESIS) {
          // Still going up - track bottom correctly
        }
        break;
      }
    }
  }

  return reps;
}

function fillMissing(values: number[]): number[] {
  const result = [...values];
  // Forward fill first
  let last = values.find((v) => v >= 0) ?? 0.5;
  for (let i = 0; i < result.length; i++) {
    if (result[i] < 0) result[i] = last;
    else last = result[i];
  }
  return result;
}
