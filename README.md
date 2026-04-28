# Lift Form Analyzer

Barbell back squat form analysis from side-view video. Detects reps, checks form against the StrongLifts technique standard, and returns a per-rep report with annotated key frames and coaching cues.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set your Anthropic API key (coaching narrative — optional, app works without it)
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Run
npm run dev
```

Open http://localhost:3000, drop in a side-view squat video, get a report.

## Running tests

```bash
npm test
```

Tests use synthetic `PoseFrame[]` data — no real video files needed. Three fixture scenarios:

- `generateGoodSquatVideo()` — two reps with clean depth and minimal knee drift
- `generateShallowSquatVideo()` — two reps where hip crease stays above knee
- `generateForwardKneeDriftVideo()` — one rep where knee continues forward past mid-descent

---

## Architectural decisions

### 1. Platform: Web (Next.js)

**Decision:** Next.js web app, run locally with `npm run dev`.

**Why not iOS native?** Requires Xcode, a developer account, and doesn't run on Windows/Linux. The MVP needs to be runnable by anyone with Node.js.

**Why not React Native / Flutter?** Cross-platform mobile adds build toolchain complexity. For an MVP a browser app is simpler: one command to run, no app stores, works on any OS.

**Trade-off accepted:** Browser-based MediaPipe WASM is slightly slower than native Vision framework on Apple Silicon. For pre-recorded video analysis (~30s target) this is acceptable — we're not doing real-time.

### 2. Pose pipeline: Hybrid (MediaPipe + Claude)

**Decision:** In-browser MediaPipe `PoseLandmarker` (BlazePose Lite) for geometry → Claude API for coaching narrative.

**Why hybrid over pure rule-based?** Rule-based gives correct verdicts but robotic output ("depth: FAILED"). A coach's voice — "your hips shot up on rep 3, drive chest and hips together" — is what actually helps the lifter. The LLM is good at that.

**Why hybrid over pure LLM vision?** A vision LLM can't reliably count reps or give pixel-level depth verdicts. It also costs ~$0.05–0.20/video on sampled frames vs. ~$0.001 for a compact JSON summary to Claude. The geometric pipeline is deterministic — the same video always produces the same depth verdict.

**Pipeline flow:**
```
Video file
  → MediaPipe PoseLandmarker (WASM, in-browser)
  → PoseFrame[] (33 keypoints × N frames)
  → Rep segmentation (hip-Y FSM)
  → Per-rep geometric checks (rules.ts)
  → FormAnalysis (structured JSON)
  → Claude API (compact JSON summary → narrative)
  → Report rendered to user
```

### 3. Bar path estimation

**Implementation:** The shoulder midpoint (`(left_shoulder + right_shoulder) / 2`) proxies bar position.

**Why:** The bar isn't a body keypoint. For high-bar squat the bar sits on the traps just above the shoulder line. For low-bar it sits 2–3 inches lower, so drift estimates will appear slightly smaller than reality.

**Failure modes:**
- Loose clothing creates keypoint noise — smoothed with 5-frame moving average
- Camera jitter adds systematic horizontal drift to all readings
- Low-bar placement introduces a constant Y-offset (not a drift error)

Bar drift is reported as a percentage of torso length to normalize across camera distances.

### 4. Rep segmentation

**Algorithm:** Finite state machine on smoothed hip-midpoint Y values.

**States:** `standing → descending → bottom → ascending → standing`

**Smoothing:** 7-frame moving average on hip Y before FSM processing. Missing frames (occluded keypoints) are forward-filled.

**Walkout/rerack filtering:** A rep must show ≥8% hip Y change and span ≥15 frames (~1 second at 15fps). This filters short vertical movements from walkout steps.

**Hysteresis:** 2% Y-change threshold prevents noise-triggered state transitions.

---

## Form rules (StrongLifts source)

All thresholds are configurable in `SQUAT_RULE_CONFIGS` in `src/lib/analyzers/squat/rules.ts` — no code change needed to tune them.

| Rule | StrongLifts reference | Implementation |
|------|----------------------|----------------|
| Depth | "Squat Depth" | Hip-Y vs Knee-Y at bottom + torso tolerance |
| Knee travel | "Knees" | Knee-X change in second half of descent |
| Hip shoot | "Back Angle" | Hip vs shoulder ascent rate ratio |
| Bar path | "Bar Path" | Shoulder-midpoint X drift as % of torso |
| Bottom dwell | "Descent & Ascent" | Dwell time in ms |
| Heel lift | "Feet" | Ankle angle change proxy |
| Head position | (implied) | Nose angle vs shoulder line |
| Butt wink | "Lower Back" | Hip-shoulder vector proxy (low confidence — flagged conservatively) |

### Conflicts with StrongLifts page

If the StrongLifts page is updated, the page wins. Flag here:

- **Stance width:** Analyzer flags via shoulder-to-heel distance but doesn't reject borderline stances. StrongLifts specifies "shoulder-width" which coaches interpret differently.
- **Heel lift:** We use an ankle angle proxy from side view. StrongLifts page recommends front-view verification — we note this in the report.

---

## Known limitations

1. **Side-view only.** Front or 45° footage is rejected.
2. **Single person.** Only the most confident detection is used.
3. **Low-bar vs. high-bar not distinguished.** Both use the same rules; bar-path proxy is less accurate for low-bar.
4. **Butt wink detection is weak.** 2D pose can't reliably distinguish posterior pelvic tilt from forward hip hinge. High-confidence threshold; marked `unknown` when below it.
5. **Occlusion by rack.** Keypoint confidence drops if lifter is partially occluded; affected rules return `unknown`.

---

## Roadmap: adding deadlift

1. Create `src/lib/analyzers/deadlift/rules.ts` with deadlift rule configs (hip hinge angle, bar over midfoot, back angle through the pull, lockout).
2. Create `src/lib/analyzers/deadlift/analyzer.ts` implementing `LiftAnalyzer`.
3. Register in `src/lib/analyzers/index.ts`:
   ```typescript
   import { DeadliftAnalyzer } from "./deadlift/analyzer";
   const analyzers = {
     squat: new SquatAnalyzer(),
     deadlift: new DeadliftAnalyzer(),
   };
   ```
4. Add a lift selector to `page.tsx`.

The pose extractor, rep segmenter, report renderer, and Claude narrative route require **zero changes**.

---

## Project structure

```
src/
  lib/
    core/
      types.ts            # All shared types + LiftAnalyzer interface
      geometry.ts         # Pure geometric helpers
      repSegmenter.ts     # Hip-Y FSM rep detection
      poseExtractor.ts    # MediaPipe integration (client-side)
      reportRenderer.ts   # Canvas skeleton + bar-path overlay
      orchestrator.ts     # End-to-end pipeline coordinator
    analyzers/
      index.ts            # Lift registry
      squat/
        rules.ts          # Rule configs + geometric checks
        analyzer.ts       # SquatAnalyzer implements LiftAnalyzer
  app/
    page.tsx
    api/narrative/        # Claude API route
  components/
    VideoUpload.tsx
    AnalysisReport.tsx
    RepCard.tsx
tests/
  fixtures/poseFixtures.ts
  squat.test.ts
```
