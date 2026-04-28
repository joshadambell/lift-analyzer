# Lift Form Analyzer

Side-view barbell form analysis for four lifts: **back squat**, **conventional deadlift**, **bench press**, and **Romanian deadlift**. Detects reps, runs geometric checks against a coaching knowledge base, and returns a per-rep report with coaching cues — powered by MediaPipe in-browser pose estimation and Claude for narrative.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set your Anthropic API key (coaching narrative — optional, app works without it)
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Run
npm run dev
```

Open http://localhost:3000, select a lift type, drop in a side-view video, get a report.

## Running tests

```bash
npm test
```

Tests use synthetic `PoseFrame[]` data — no real video files needed.

---

## Architectural decisions

### 1. Platform: Web (Next.js)

**Decision:** Next.js web app, run locally with `npm run dev`.

**Why not native mobile?** Requires platform SDKs and distribution. A browser app runs on any OS with Node.js, no app store needed.

**Trade-off accepted:** Browser-based MediaPipe WASM is slightly slower than native Vision framework. For pre-recorded video analysis this is acceptable — we're not doing real-time.

### 2. Pose pipeline: Hybrid (MediaPipe + Claude)

**Decision:** In-browser MediaPipe `PoseLandmarker` (BlazePose Lite) for geometry → Claude API for coaching narrative.

**Why hybrid over pure LLM vision?** A vision LLM can't reliably count reps or give pixel-level depth verdicts. The geometric pipeline is deterministic — same video always produces same verdict. The LLM handles natural coaching language.

**Pipeline flow:**
```
Video file
  → MediaPipe PoseLandmarker (WASM, in-browser)
  → PoseFrame[] (33 keypoints × N frames)
  → Rep segmentation (lift-specific signal FSM)
  → Per-rep geometric checks (rules.ts per lift)
  → FormAnalysis (structured JSON)
  → Claude API (compact JSON + KB context → narrative)
  → Report rendered to user
```

### 3. Knowledge base architecture

**Decision:** Coaching language lives in `src/lib/knowledge/lifts.json`; geometric thresholds and detection logic live in code.

**Why separate KB from code?** The KB contains coaching vocabulary (fault descriptions, corrections, cue language) sourced from established technique standards. These change for editorial reasons independent of detection math. Keeping them separate means a coach can update cue text without touching analyzer logic.

**Usage pattern:**
- `getFault(liftKey, faultId)` — looks up a fault by ID, returns description + corrections
- Rule files call `cuesFromFault()` to generate passed/borderline/failed cue sets
- The narrative API injects relevant KB context for the top rule failures

### 4. Rep segmentation — signal abstraction

**Decision:** `segmentReps()` accepts a `SignalExtractor` function instead of hard-coding hip-Y.

**Why:** Different lifts need different signals:
- **Squat / RDL:** `hipYSignal` — hip rises and falls
- **Bench press:** `wristYSignal` — wrist descends to chest and returns
- **Deadlift:** `invertedWristYSignal` — wrist rises to lockout; negated so the same FSM logic applies

Using `NaN` (not `-1`) as the missing-keypoint sentinel was necessary because inverted signal values are in `[-1, 0]`.

### 5. Bar path estimation

**Implementation:** Wrist midpoint proxies bar position for most lifts. Shoulder midpoint is used for squat bar path.

Bar drift is reported as a percentage of torso length to normalize across camera distances and body sizes.

---

## Supported lifts and checks

### Back squat

| Rule | What's checked |
|------|----------------|
| Depth | Hip crease vs. knee crease at bottom |
| Knee travel | Knee-X forward drift in second half of descent |
| Hip shoot | Hip vs. shoulder ascent rate ratio |
| Bar path | Shoulder-midpoint X drift as % of torso |
| Bottom dwell | Dwell time at the hole |
| Heel lift | Ankle angle change proxy |

### Conventional deadlift

| Rule | What's checked |
|------|----------------|
| Hip shoot | Hip vs. shoulder rise rate in first 30% of pull |
| Bar drift | Wrist-X distance from ankle during concentric |
| Lockout | Backward lean at lockout (sign-aware via `facingSign()`) |
| Hitching | Non-monotonic wrist-Y stalls during concentric |

### Bench press

| Rule | What's checked |
|------|----------------|
| Pause | Dwell time at chest (bounce detection) |
| Lockout | Elbow extension angle at finish |
| Butt lift | Hip-Y deviation from setup baseline during press |
| Bar path | Wrist-X horizontal drift during rep |

> **Note:** Elbow flare and uneven bar path require a front view and are not detected. The KB context for those faults is sent to the narrative model, which can mention them generically.

### Romanian deadlift

| Rule | What's checked |
|------|----------------|
| Squat pattern | Knee angle change (should stay near-constant in RDL) |
| Bar drift | Wrist-X distance from knee during descent |
| Hyperextension | Backward lean at lockout (sign-aware) |

---

## Known limitations

1. **Side-view only.** Front or 45° footage is rejected.
2. **Single person.** Only the most confident detection is used.
3. **Facing direction.** `facingSign()` uses toe vs. heel X to determine camera orientation for signed lean measurements. Returns `unknown` for checks requiring it when foot keypoints aren't visible.
4. **Bench butt-lift.** Baseline is taken from the first 5 setup frames. Very short videos or late camera cuts may affect baseline quality.
5. **Deadlift sumo.** Bar drift check uses ankle as reference (conventional). Sumo stance produces systematically higher drift readings.

---

## Project structure

```
src/
  lib/
    knowledge/
      lifts.json          # KB: fault descriptions, corrections, coaching cues
      index.ts            # getFault(), getLift(), liftDisplayName(), etc.
    core/
      types.ts            # Shared types + LiftAnalyzer interface
      geometry.ts         # Geometric helpers (angleDeg, facingSign, torsoLength…)
      repSegmenter.ts     # FSM rep detection with pluggable signal extractor
      poseExtractor.ts    # MediaPipe PoseLandmarker integration (client-side)
      analysisCommon.ts   # Shared helpers (estimateBottomDwell, buildTopFixes…)
      reportRenderer.ts   # Canvas skeleton + bar-path overlay
      orchestrator.ts     # End-to-end pipeline coordinator
    analyzers/
      index.ts            # Lift registry { squat, deadlift, bench_press, romanian_deadlift }
      squat/
        rules.ts
        analyzer.ts
      deadlift/
        rules.ts
        analyzer.ts
      bench/
        rules.ts
        analyzer.ts
      rdl/
        rules.ts
        analyzer.ts
  app/
    page.tsx              # Lift selector + upload UI
    api/narrative/        # Claude coaching narrative route
  components/
    VideoUpload.tsx
    AnalysisReport.tsx
    RepCard.tsx
tests/
  fixtures/poseFixtures.ts
  squat.test.ts
```

## Adding a new lift

1. Add an entry to `src/lib/knowledge/lifts.json` with faults, corrections, and joint angles.
2. Create `src/lib/analyzers/<lift>/rules.ts` — use `cuesFromFault()` for coaching language, write geometric checks as pure functions over `PoseFrame[]`.
3. Create `src/lib/analyzers/<lift>/analyzer.ts` implementing `LiftAnalyzer` — pick the appropriate `SignalExtractor` for rep segmentation.
4. Register in `src/lib/analyzers/index.ts`.
5. Add `RULE_TO_FAULT` entries in `src/app/api/narrative/route.ts` for KB context injection.

The pose extractor, report renderer, and narrative route require no changes.
