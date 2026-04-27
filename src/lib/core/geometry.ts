import type { Keypoint, Point2D, PoseFrame } from "./types";

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Angle at vertex B in the triangle A-B-C, in degrees */
export function angleDeg(a: Point2D, b: Point2D, c: Point2D): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBa = Math.sqrt(ba.x ** 2 + ba.y ** 2);
  const magBc = Math.sqrt(bc.x ** 2 + bc.y ** 2);
  if (magBa === 0 || magBc === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBa * magBc)))) * (180 / Math.PI);
}

export function getKp(frame: PoseFrame, name: string): Keypoint | null {
  return frame.keypoints[name] ?? null;
}

/** Mean of an array */
export function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Simple moving average smoothing */
export function smoothMovingAverage(values: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return mean(values.slice(lo, hi + 1));
  });
}

/** Torso length: distance from hip midpoint to shoulder midpoint (normalized coords) */
export function torsoLength(frame: PoseFrame): number | null {
  const ls = getKp(frame, "left_shoulder");
  const rs = getKp(frame, "right_shoulder");
  const lh = getKp(frame, "left_hip");
  const rh = getKp(frame, "right_hip");
  if (!ls || !rs || !lh || !rh) return null;
  const shoulders = midpoint(ls, rs);
  const hips = midpoint(lh, rh);
  return distance(shoulders, hips);
}

/** Side-view dominant keypoint: prefer the higher-visibility side */
export function dominantSide(
  frame: PoseFrame,
  leftName: string,
  rightName: string
): Keypoint | null {
  const l = getKp(frame, leftName);
  const r = getKp(frame, rightName);
  if (!l && !r) return null;
  if (!l) return r;
  if (!r) return l;
  return l.visibility >= r.visibility ? l : r;
}

/** Detect camera view: side-view has high visibility asymmetry between left/right keypoints */
export function estimateSideViewConfidence(frames: PoseFrame[]): number {
  const sample = frames.slice(0, Math.min(30, frames.length));
  const asymmetries = sample.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    const lh = getKp(f, "left_hip");
    const rh = getKp(f, "right_hip");
    if (!ls || !rs || !lh || !rh) return 0;
    // Side view: one shoulder is more visible than the other
    const shoulderAsym = Math.abs(ls.visibility - rs.visibility);
    const hipAsym = Math.abs(lh.visibility - rh.visibility);
    return (shoulderAsym + hipAsym) / 2;
  });
  return mean(asymmetries);
}
