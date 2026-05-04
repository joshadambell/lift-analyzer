"use client";

/**
 * Canvas-based skeleton and bar-path renderer.
 * Draws annotated key frames for the report.
 */

import type { PoseFrame, RepMetrics } from "./types";
import { getKp, midpoint, smoothMovingAverage } from "./geometry";

const SKELETON_CONNECTIONS: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
  ["left_ankle", "left_heel"], ["right_ankle", "right_heel"],
  ["left_ankle", "left_foot_index"], ["right_ankle", "right_foot_index"],
];

const COLORS = {
  skeleton: "#00ff88",
  joint: "#ffffff",
  barPath: "#ff6b35",
  barPathCurrent: "#ffdc00",
  hipKneeLine: "#00d4ff",
  text: "#ffffff",
  textShadow: "#000000",
  depthPass: "#00ff88",
  depthFail: "#ff4444",
};

// Cap rendered key frames to avoid holding multi-MB GPU textures per rep.
// 1280px is plenty for the report cards and keeps peak memory low.
const MAX_KEYFRAME_WIDTH = 1280;

export async function renderRepKeyFrame(
  videoFile: File,
  rep: RepMetrics,
  allFrames: PoseFrame[],
  repFrames: PoseFrame[]
): Promise<string> {
  const { extractFrameBitmap } = await import("./poseExtractor");
  const bitmap = await extractFrameBitmap(videoFile, rep.bottomTimestamp);

  const scale = Math.min(1, MAX_KEYFRAME_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const bottomPoseFrame = allFrames[rep.bottomFrame];
  if (bottomPoseFrame) {
    drawBarPath(ctx, repFrames, canvas.width, canvas.height);
    drawSkeleton(ctx, bottomPoseFrame, canvas.width, canvas.height);
    drawDepthIndicator(ctx, bottomPoseFrame, rep, canvas.width, canvas.height);
    drawRepLabel(ctx, rep, canvas.width, canvas.height);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  // Zero out dimensions to immediately release the GPU texture rather than
  // waiting for GC — critical on mobile where the browser won't GC between reps.
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  w: number,
  h: number
) {
  ctx.lineWidth = Math.max(2, w / 300);

  // Draw connections
  ctx.strokeStyle = COLORS.skeleton;
  ctx.globalAlpha = 0.85;
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const kpA = getKp(frame, a);
    const kpB = getKp(frame, b);
    if (!kpA || !kpB) continue;
    if (kpA.visibility < 0.3 || kpB.visibility < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(kpA.x * w, kpA.y * h);
    ctx.lineTo(kpB.x * w, kpB.y * h);
    ctx.stroke();
  }

  // Draw joints
  const radius = Math.max(4, w / 200);
  for (const [name, kp] of Object.entries(frame.keypoints)) {
    if (kp.visibility < 0.4) continue;
    ctx.globalAlpha = Math.min(1, kp.visibility);
    ctx.fillStyle = COLORS.joint;
    ctx.beginPath();
    ctx.arc(kp.x * w, kp.y * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawBarPath(
  ctx: CanvasRenderingContext2D,
  frames: PoseFrame[],
  w: number,
  h: number
) {
  const points = frames.map((f) => {
    const ls = getKp(f, "left_shoulder");
    const rs = getKp(f, "right_shoulder");
    if (ls && rs) return midpoint(ls, rs);
    if (ls) return { x: ls.x, y: ls.y };
    if (rs) return { x: rs.x, y: rs.y };
    return null;
  }).filter((p): p is { x: number; y: number } => p !== null);

  if (points.length < 2) return;

  const smoothedX = smoothMovingAverage(points.map((p) => p.x), 5);
  const smoothedY = smoothMovingAverage(points.map((p) => p.y), 5);

  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(2, w / 250);
  ctx.strokeStyle = COLORS.barPath;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  ctx.moveTo(smoothedX[0] * w, smoothedY[0] * h);
  for (let i = 1; i < smoothedX.length; i++) {
    ctx.lineTo(smoothedX[i] * w, smoothedY[i] * h);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Highlight current (bottom) position
  ctx.fillStyle = COLORS.barPathCurrent;
  ctx.beginPath();
  const lastX = smoothedX.at(-1)! * w;
  const lastY = smoothedY.at(-1)! * h;
  ctx.arc(lastX, lastY, Math.max(5, w / 120), 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawDepthIndicator(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  rep: RepMetrics,
  w: number,
  h: number
) {
  const depthResult = rep.ruleResults.find((r) => r.ruleId === "depth");
  if (!depthResult) return;

  const hip = frame.keypoints["left_hip"] ?? frame.keypoints["right_hip"];
  const knee = frame.keypoints["left_knee"] ?? frame.keypoints["right_knee"];
  if (!hip || !knee) return;

  const color = depthResult.verdict === "passed" ? COLORS.depthPass : COLORS.depthFail;

  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);

  // Draw horizontal line at hip level
  ctx.beginPath();
  ctx.moveTo(0, hip.y * h);
  ctx.lineTo(w, hip.y * h);
  ctx.stroke();

  // Draw horizontal line at knee level
  ctx.strokeStyle = COLORS.hipKneeLine;
  ctx.beginPath();
  ctx.moveTo(0, knee.y * h);
  ctx.lineTo(w, knee.y * h);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawRepLabel(
  ctx: CanvasRenderingContext2D,
  rep: RepMetrics,
  w: number,
  h: number
) {
  const depthResult = rep.ruleResults.find((r) => r.ruleId === "depth");
  const verdict = depthResult?.verdict ?? "unknown";
  const color =
    verdict === "passed" ? COLORS.depthPass :
    verdict === "failed" ? COLORS.depthFail : "#ffdc00";

  const fontSize = Math.max(14, w / 45);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "left";

  const label = `Rep ${rep.repNumber} · Depth: ${verdict.toUpperCase()}`;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(8, 8, ctx.measureText(label).width + 16, fontSize + 12);
  ctx.fillStyle = color;
  ctx.fillText(label, 16, fontSize + 10);
}
