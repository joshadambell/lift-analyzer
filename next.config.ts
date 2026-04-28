import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Required for SharedArrayBuffer / WASM multi-threading in all browsers.
          // Without these, Emscripten's GL context init fails at module load time.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // "credentialless" enables SharedArrayBuffer on both Chrome and
          // iOS Safari 15.4+ without blocking cross-origin resources the
          // way "require-corp" does.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
