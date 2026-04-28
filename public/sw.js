// Service worker for Lift Form Analyzer PWA.
// Precaches MediaPipe WASM + model so analysis works offline after first load.

const CACHE = "lift-analyzer-v1";

const PRECACHE_URLS = [
  "/",
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
  "/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "/mediapipe/pose_landmarker_lite.task",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only cache same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Cache-first for WASM + model (large, immutable assets)
  if (
    url.pathname.startsWith("/mediapipe/") ||
    url.pathname === "/"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for everything else (JS chunks, API routes)
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
