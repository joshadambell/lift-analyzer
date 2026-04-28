"use client";

/**
 * Pose extraction using MediaPipe Tasks Vision PoseLandmarker.
 * Runs entirely in-browser via WASM — no server round-trip for pose data.
 *
 * Bar path assumption: we use the shoulder midpoint as a proxy for bar position.
 * Failure modes: loose clothing shifts the acromion proxy; low-bar squat places
 * bar below shoulders so drift looks smaller than it is; camera jitter adds noise.
 */

import type { PoseFrame, Keypoint } from "./types";

// MediaPipe landmark indices → semantic names (BlazePose 33-keypoint model)
const LANDMARK_NAMES: string[] = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer",
  "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right",
  "left_shoulder", "right_shoulder",
  "left_elbow", "right_elbow",
  "left_wrist", "right_wrist",
  "left_pinky", "right_pinky",
  "left_index", "right_index",
  "left_thumb", "right_thumb",
  "left_hip", "right_hip",
  "left_knee", "right_knee",
  "left_ankle", "right_ankle",
  "left_heel", "right_heel",
  "left_foot_index", "right_foot_index",
];

const KEY_VISIBILITY_LANDMARKS = [
  "left_hip", "right_hip", "left_knee", "right_knee",
  "left_shoulder", "right_shoulder",
];

let poseLandmarkerModule: typeof import("@mediapipe/tasks-vision") | null = null;
let poseLandmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;

// MediaPipe's PoseLandmarker enforces strictly monotonic timestamps across
// every detectForVideo call on the same instance. Each new video resets
// real time to 0, so we offset MediaPipe-side timestamps by the running max
// to keep the invariant. PoseFrame.timestamp still stores real video time.
let mediaPipeTimestampOffsetMs = 0;

async function ensurePoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;

  if (!poseLandmarkerModule) {
    poseLandmarkerModule = await import("@mediapipe/tasks-vision");
  }
  const { PoseLandmarker, FilesetResolver } = poseLandmarkerModule;

  // Use locally-bundled WASM to avoid CDN version mismatch (installed: 0.10.35)
  // and cross-origin issues. Files are in public/mediapipe/wasm/.
  const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

  // Model also served locally to satisfy COEP: require-corp.
  const MODEL_URL = "/mediapipe/pose_landmarker_lite.task";

  const commonOptions = {
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  // Try GPU first; fall back to CPU if WebGL/GPU context fails (common in
  // privacy-hardened browsers like Brave with WebGL blocked).
  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      ...commonOptions,
    });
  } catch (gpuErr) {
    console.warn("[poseExtractor] GPU delegate failed, falling back to CPU:", gpuErr);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      ...commonOptions,
    });
  }

  return poseLandmarker;
}

export async function extractPosesFromVideo(
  videoFile: File,
  onProgress?: (pct: number) => void
): Promise<PoseFrame[]> {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const landmarker = await ensurePoseLandmarker();
  const frames: PoseFrame[] = [];
  const FPS_SAMPLE = 15; // sample at 15fps for performance
  const duration = video.duration;
  const step = 1 / FPS_SAMPLE;

  let frameIndex = 0;
  let currentTime = 0;

  video.currentTime = 0;
  await seekTo(video, 0);

  while (currentTime <= duration) {
    await seekTo(video, currentTime);

    const timestampMs = currentTime * 1000;
    // MediaPipe sees offset+videoTime to satisfy monotonic-clock requirement
    // across multiple analyses on the same landmarker instance.
    const result = landmarker.detectForVideo(video, mediaPipeTimestampOffsetMs + timestampMs);

    if (result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const worldLandmarks = result.worldLandmarks?.[0];

      const keypoints: Record<string, Keypoint> = {};
      for (let i = 0; i < landmarks.length; i++) {
        const name = LANDMARK_NAMES[i] ?? `landmark_${i}`;
        keypoints[name] = {
          x: landmarks[i].x,
          y: landmarks[i].y,
          z: worldLandmarks?.[i]?.z ?? landmarks[i].z ?? 0,
          visibility: landmarks[i].visibility ?? 0,
          name,
        };
      }

      const confidence =
        KEY_VISIBILITY_LANDMARKS.reduce(
          (sum, n) => sum + (keypoints[n]?.visibility ?? 0),
          0
        ) / KEY_VISIBILITY_LANDMARKS.length;

      frames.push({ timestamp: timestampMs, frameIndex, keypoints, confidence });
    }

    frameIndex++;
    currentTime += step;
    onProgress?.(Math.min(99, (currentTime / duration) * 100));
  }

  URL.revokeObjectURL(url);

  // Bump the MediaPipe timestamp offset past this video's last timestamp so
  // the next analysis starts in valid (still-increasing) timestamp territory.
  // +1000ms buffer to be safe against any interleaved calls.
  mediaPipeTimestampOffsetMs += duration * 1000 + 1000;

  onProgress?.(100);
  return frames;
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = time;
  });
}

/** Extract a single video frame as an ImageBitmap for canvas rendering */
export async function extractFrameBitmap(
  videoFile: File,
  timestampMs: number
): Promise<ImageBitmap> {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;

  await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); });
  await seekTo(video, timestampMs / 1000);

  const bitmap = await createImageBitmap(video);
  URL.revokeObjectURL(url);
  return bitmap;
}
