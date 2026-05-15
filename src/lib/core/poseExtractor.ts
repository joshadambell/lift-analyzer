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

// Minimal type for the VideoFrameCallbackMetadata parameter
interface VideoFrameMetadata { mediaTime: number; }

// iOS Safari: rvfc fires once then stalls when playbackRate != 1 — force seek path.
// Android/mobile: reduced fps keeps per-frame inference from blocking the thread too long.
function isMobileDevice(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
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
  const mobile = isMobileDevice();
  // Lower fps on mobile: reduces inference calls from ~180 to ~72 for a 12s video.
  // Rep segmentation and form rules work fine at 6fps; reps are seconds long.
  const FPS_SAMPLE = mobile ? 6 : 15;
  const SAMPLE_INTERVAL = 1 / FPS_SAMPLE;
  const duration = video.duration;

  // Skip rvfc on iOS: playbackRate != 1 causes rvfc to stall after the first
  // callback on iOS Safari. Also skip on any mobile where blocking inference
  // would prevent the browser from delivering subsequent callbacks.
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const useRvfc = !isIOS && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  if (useRvfc) {
    // Fast path: decode frames in playback order, no per-frame seek overhead.
    // 2× is the sweet spot: fast enough to halve wall time, slow enough that
    // the browser decodes every frame (not just H.264 keyframes). At 16× most
    // browsers skip inter-frames and rvfc only fires ~1/sec — producing ~15
    // frames for a 12-second video instead of ~180.
    video.playbackRate = 2;

    let lastSampledTime = -SAMPLE_INTERVAL;
    let frameIndex = 0;

    await new Promise<void>((resolve, reject) => {
      // Stall guard: if no rvfc callback arrives for 2s the video has ended
      // (or stalled). Detached blob-URL videos don't reliably fire 'ended'
      // at playbackRate != 1, so polling for silence is more robust.
      let stallTimer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(stallTimer); resolve(); };
      const resetStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(done, 2000);
      };

      const onFrame = (_now: DOMHighResTimeStamp, meta: VideoFrameMetadata) => {
        const mediaTime = meta.mediaTime;

        if (mediaTime - lastSampledTime >= SAMPLE_INTERVAL) {
          lastSampledTime = mediaTime;
          const timestampMs = mediaTime * 1000;
          const result = landmarker.detectForVideo(video, mediaPipeTimestampOffsetMs + timestampMs);
          appendFrame(result, timestampMs, frameIndex++, frames);
          onProgress?.(Math.min(99, (mediaTime / duration) * 100));
        }

        if (mediaTime < duration - SAMPLE_INTERVAL * 0.5) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (video as any).requestVideoFrameCallback(onFrame);
          // Reset stall guard AFTER inference and after requesting the next
          // callback — this measures silence between callbacks, not the
          // duration of inference itself (which can exceed the old 2s window).
          resetStall();
        } else {
          done();
        }
      };

      resetStall(); // arm the initial stall timer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (video as any).requestVideoFrameCallback(onFrame);
      video.play().catch(reject);
    });

    video.pause();
  } else {
    // Seek path: universally supported. On mobile, inference blocks the main
    // thread per frame, so yield via setTimeout between seeks to keep the UI
    // responsive and prevent WKWebView from throttling the JS task.
    let frameIndex = 0;
    let currentTime = 0;
    const step = SAMPLE_INTERVAL;

    video.currentTime = 0;
    await seekTo(video, 0);

    while (currentTime <= duration) {
      await seekTo(video, currentTime);
      const timestampMs = currentTime * 1000;
      const result = landmarker.detectForVideo(video, mediaPipeTimestampOffsetMs + timestampMs);
      appendFrame(result, timestampMs, frameIndex++, frames);
      currentTime += step;
      onProgress?.(Math.min(99, (currentTime / duration) * 100));
      // Yield to the browser between frames so progress updates repaint and
      // iOS WKWebView doesn't kill the long-running synchronous task.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  URL.revokeObjectURL(url);
  mediaPipeTimestampOffsetMs += duration * 1000 + 1000;
  onProgress?.(100);
  return frames;
}

function appendFrame(
  result: { landmarks: { x: number; y: number; z?: number; visibility?: number }[][]; worldLandmarks?: { z?: number }[][] },
  timestampMs: number,
  frameIndex: number,
  frames: PoseFrame[],
): void {
  if (result.landmarks.length === 0) return;
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
  // Clear src so the browser drops its decoded frame buffer immediately.
  video.src = "";
  video.load();
  return bitmap;
}
