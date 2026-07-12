# Galaxy Shader — Session Context

Working file: `galaxy_editor_1.html` (webview editor). All iteration happens here first;
`galaxy_shader_V1.2.glsl`, `FLUTTER_IMPLEMENTATION.md`, and
`../flutter ideations/shaders/galaxy.frag` are **out of sync** and get updated in one
pass when iteration is done ("say the word and I'll sync them").

## Goal

Match our procedural WebGL spiral galaxy to the production spiral video
(`spiral_animation.mp4` / `spiral_animation dive.mp4` — NOT shader-made). The webview
is the prototyping ground; everything must stay **pure fragment-shader** (no textures,
no multipass) so it ports 1:1 to Flutter's `FragmentProgram`.

## Reference dive analysis (from the production video, 6.4 s)

- Gentle ease-in (~1.5 s barely moves), continuous acceleration after.
- Total zoom only ~10–15× (ours dives ~10,000×). Hole maxes at ~25–30 % screen width
  and dissolves into the star swarm; never engulfs the screen.
- Late dive = big chunky stars with 4-point diffraction flares + bloom, well spaced.
- Stars exit the frame entirely by the end (not "fade while visible" — corrected by user).
- Haze stays textured mid-dive, thins as stars take over; ends black behind stars.

## Changes implemented this session (all in galaxy_editor_1.html)

1. **Black hole as a hole** — no rim glow in black-hole mode; wide soft edge
   (edgeIn 0.45 / edgeOut 1.60); haze & stars feather into the void.
2. **Dive duration 5.0 s** (was 5.5) + 700 ms hold + 1.5 s fade-in of new state
   (hold/fade are for testing the state switch, intentionally kept).
3. **Pause/Resume button** during dive (shifts zoom clock by paused duration).
4. **Instant Normal/Boom buttons** — abort any in-progress dive and snap to end state.
5. **Star size variance** — per-star `sizeMul = mix(0.5, 1.8, hs²)` (skewed small).
6. **LOD refill cap** — `uMaxStarLod` (default 2.0): past that many grid doublings the
   field stops refining, so diving reads as flying PAST stars.
7. **Stellar bulge + disk population** — `uBulge` (default 0.70). Gaussian
   falloff `exp(-r² · 3.2)` drives per-star PRESENCE (hash-gated count, not
   dimming; was exponential `exp(-r·1.85)` — its long tail scattered stars
   too far outside the disk, user call: near-flat core, hard radial cutoff);
   same lattice as arm stars (max() combine, no double-brightening); disk stars at
   0.8× arm brightness. Sizes/twinkle identical to arm stars.
8. **Arm outer taper** — in `armAngleMask`: `radialFade *= exp(-max(r-1,0)² · 8)`.
   Identity below r = 1 (inner spiral untouched); tails fragment into sparse dots.
9. **Haze edge dither** — ±0.5/255 static hash noise before output kills the 8-bit
   quantization "oval terminator" around the galaxy.
10. **Unified color pickers** — four pickers (Center/Arm/Nebula/Star) bound to the
    active mode's palette. Normal mode = exact algebraic decomposition of the old
    grayscale `lum` formula (body / star-with-cross-term / haze), bit-identical when
    all four normal colors are equal. Eight uniforms total (`u*Color` boom,
    `uNormal*Color` normal). Both palettes persist across mode switches.
    (First attempt shared boom's palette → normal turned blue → reverted, redone right.)
11. **Perspective camera (3D look)** — replaced orthographic `uSquash` with `uCamTilt`
    look-at camera: orbits origin at distance `2·uZoom/FOV`, FOV = 0.3 (const, mild
    lens), always aims at the galaxy center → hole pinned to screen center, dive flies
    straight into it. Closed-form ray/plane, ~10 lines. `groundVis` fades the galaxy
    near the horizon (floored divisor avoids precision banding).
    At `uCamTilt = 0` reduces exactly to the old flat mapping.
    (First attempt looked ahead instead of at center → off-center smear + dive missing
    the hole → fixed with look-at.)
12. **Disk thickness (3D stars)** — `uDiskThickness` (default now 0.00, user call; **0 = old flat
    look, verified pixel-identical**). A star at height h appears in the sampled
    z = 0 plane frame shifted by exactly `h · parVec`, `parVec = (d.x, d.y)/-d.z`
    from the camera ray (computed per pixel in mainImage before the plane hit,
    rotated into the lattice frame). Two populations:
    (a) *Slab fuzz* — per-star hashed height on the existing arm/bulge lattice,
    offset clamped sub-cell (`0.45/GRID`) so the 3×3 lookup never clips a shifted
    star (the trap that forbids big heights on the fine lattice). Fuzzy rim at rest.
    (b) *Floaters* — new `floaterField()`: sparse COARSE lattice (GRID 2.6, no LOD,
    BASE_R 0.010, chunkier + full brightness so they're trackable), real signed
    heights up to ±5 % of disk radius (magnitude biased off zero), same exact
    offset — big offsets stay sub-cell because cells are big. Presence gated by
    `exp(-r·1.1)` disk profile; screen size capped ~15 px in deep zoom; twinkle
    like arm stars; max()-combined into starsV. These slide against the field
    during the dive = real parallax.
    Cost ≈ +9–10 % frame when on (SwiftShader measurement, overstates GPU);
    coherent uniform gates → zero cost at 0.
13. **Dive zoom floor — tried and REMOVED.** Clamping `currentZoom` at a floor
    just holds the zoom flat for the rest of the 5.5 s dive before the fade — it
    reads as "the animation pauses before it ends," not as the reference's
    composed ending (user call). A real reference-style ending needs the dive
    *choreography* re-timed (shorter duration / ease-out into the floor), not a
    clamp. Sliders were confirmed live during the dive.
14. **Paused-frame repaint** — while the dive is paused the render loop skips
    drawing, so control edits used to apply only after resume. `sync()` now
    flags `pausedDirty` and the paused branch of `frame()` redraws once (no
    clocks advance). This makes pause the A/B tool: pause mid-dive, drag Disk
    thickness 0 ↔ 1, and the frozen frame updates instantly.
15. **Sheet-based 3D rework** (per-star clamped offsets were imperceptible —
    any slider value silently saturated the sub-cell clamp). Now everything
    off-plane lives on exactly-shifted SHEETS: the lattice is sampled at
    `ps = p − h·parVec`, so lookup and positions stay consistent at ANY
    height — no clamp, no clipping. Slider range 0–10 (default 0.5).
    - Arm + bulge populations are dealt across two sheets each via a
      partition hash (`partLo/partHi` in starFieldLevel — no density change;
      at h = 0 the union is exactly the flat field). Arm mask / disk falloff
      evaluated at each sheet's own footprint. Arms = thin slab (h 0.008·t),
      bulge = puffier (0.025·t), floaters = furthest (0.05·t, GRID 5.0,
      BASE_R 0.012, two sheets).
    - Flat path (thickness 0) is a separate branch — still bit-identical.
    - Perf: LOD cross-fade skip when f≈0 (coherent, halves star pass at rest,
      helps the FLAT path too); sheet lattices skipped where mask/falloff is
      below the dither floor. Thick path ≈ +29 % frame on SwiftShader
      (overstates GPU); flat baseline got ~20 % FASTER than before.
    - Perceptual note: off-plane offsets project mostly ALONG the disk, so
      stills only read via stars escaping the silhouette — that took count
      (dense floater grid), not height.
16. **Star diffraction flares + bloom** — `uFlare` (default 0.60), rebuilt
    after v1 read "unrealistically huge" (user): **final-stretch only** —
    `flareRamp = smoothstep(0.22, 0.07, uZoom)`, hard-gated `uZoom < 0.22`,
    so rest and mid-dive stars are plain dots at zero cost. ALL stars flare
    at the end: the main field gets small cell-capped crosses (the swarm),
    floaters carry the hero crosses. Spike half-length ≤ ~52 *screen* px via
    `pxCtl.x` = per-pixel worst-axis plane footprint (global uPxSize let
    near-side flares/floaters balloon into blobs); `pxCtl.y` fades flares
    approaching the horizon band (spike-stacking streaks). Thin spikes
    0.22·R; bloom deliberately tight (σ² = 2·R², weight 0.25 — wider reads
    as fog); twinkle shimmers the whole flared star. Floater size caps also
    use pxCtl.x now. Per-star gate (user: lag + too many, then "+ shape,
    smaller stars"): only hs ∈ (0.25, 0.55) of the main field flares —
    ~30 % (raised from 10 % — too subtle), SMALL cores, because a crisp + needs long thin spikes and the
    screen cap gives big cores only ~2R of stubby thick spike (reads as a
    fat diamond blob). Floaters don't flare at all — they stay soft round
    bokeh discs, matching the reference's biggest end-frame stars.
    Non-flaring stars keep the plain disc and its exact old cost.
    Star size caps use the MIN-axis per-pixel footprint (max-axis for AA
    floors): worst-axis caps bounded only the compressed screen dimension,
    so deep-zoom floaters stretched into wide white ovals on foreshortened
    regions ("crossing size limits", user). Rest state unaffected.
    Whole flare tapers to exactly zero at the reach boundary
    (`1 − smoothstep(0.65·reach, reach, dist)`) — without it the bloom
    truncated mid-glow and every flared star sat inside a visible
    clipped disc.
    Perf note: profiling showed the EARLY dive frames are the heaviest
    (full haze × 2 smokeMaps + LOD cross-fade doubling all 8 sheet passes)
    — the dive was already heavy before flares. Biggest untapped mobile
    lever: drop canvas DPR during the dive (motion hides it).
17. **Haze extinction in the deep dive** — `hazeVis = smoothstep(0.03, 0.18,
    uZoom)` multiplying smoke/b/corona (window deepened from (0.04, 0.30):
    user wanted the haze to linger and surround the viewer well into the
    zoom, then dissipate near the core). Ends black behind the star swarm
    like the reference. The gates also skip both smokeMap calls at the very
    end, so the deepest frames get FASTER.
18. **Dive zoom curve — LINEAR** (final, user call). Smoothstep ease-in and
    quadratic ease-out were both tried and reverted. Instead the dive opens
    with item 20's haze pulse, then zooms linearly (5.5 s as always).
20. **"Come alive" haze pulse on dive start** — `uHazePulse` uniform (host
    choreography, no slider; 1.0 = neutral). On Boom: 1.0 s beat BEFORE the
    zoom — nebula dims to 0.50 (smoothstep, bottom ~0.45 s), swells to 1.25
    by 1.0 s, overshoot bleeds to 1.0 over the dive's first 0.8 s. Stars
    deliberately untouched (steady stars against breathing haze sells it).
    Measured from the reference video: its mean luminance dips ~0.4–0.8 s
    in, recovers by ~1.2 s, then the dive brightens. Multiplies `hazeAmt`
    (smoke, glow layer, corona) alongside hazeVis. Verified: −43 % mean
    frame brightness at the dim bottom, swell past neutral after.
19. **Star density slider 0–4** (was 0–2; default unchanged 2.0). Largest
    stars now cap at 0.9 cell so density > ~2.9 can't clip at lattice
    borders (no-op at the old range).

## Current defaults (also the Reset state)

```
uArmCount 2 · uArmWinding 16.0 · uArmSpacing 1.12 · uHaze 0.84 · uGasClouds 0.23 · uBulge 0.50
uDiskThickness 1.35 · uFlare 0.60 · uOvalness 1.00 · uCamTilt 1.27 · uRotSpeed 0.050 · uCompactness 1.50
uStarDensity 3.00 · uMaxStarLod 2.0 · uTwinkleFraction 0.14 · uTwinkleSpeed 0.00
uCoreMode 0 · uBlackHoleSize 0.049 · uCenterSpread 0.50
boom:   center (0.294,0.376,0.569) · arm (0,0.482,1) · haze (0.259,0.345,1) · star (1,1,1)
normal: center (0.886,0.878,1) · arm (0.639,0.651,1) · haze (1,1,1) · star (1,1,1)
```

## Pending / agreed next steps (not yet implemented)

- **Late-dive star size tuning** (reference stars reach ~2 % screen width; we
  cap floaters at ~15 px — compare against the reference end frame).
- (Flare streak/blob issues from the first cut are resolved via the
  per-pixel footprint + horizon fade; spike y-foreshortening inside
  starFlare still uses constant cos(tilt) — fine in practice.)
- Zoom floor is parked entirely (slider removed — see item 13): a bare clamp just
  stalls the animation before the fade. If the reference's ~10–15× composed ending
  is ever wanted, re-time the dive choreography (ease-out into the floor) instead.
- From the 3D brainstorm: star height/parallax scatter **done** (item 12); optional
  two-layer smoke depth (moderate) still open. Full volumetric raymarch ruled out
  (mobile load). Possible cheap extra depth cue if wanted later: dim far-side stars
  by the dust field (reuses fbmdust, near-free).
- Per-pixel AA footprint under perspective (`uPxSize` currently a cos(tilt)
  approximation; revisit only if far-side stars shimmer at high tilt).
- ~~**Final Flutter sync** of all changes when iteration is done.~~ DONE —
  see item 27.

## Dev environment notes

- Preview server: `python3` via custom script in the session scratchpad
  (`serve.py`, reads PORT env var, serves the project dir, `/` →
  `galaxy_editor_1.html`). Plain `python -m http.server` fails: macOS sandbox denies
  `getcwd()`/Documents access to the preview-spawned process.
- Testing dives: browser-tool latency exceeds the 7.7 s cycle — schedule clicks
  inside the page (`preview_eval` + `setTimeout` on `#boom-btn` / `#pause-btn`) and
  screenshot while paused.
21. **Dive camera tilt descent** — during the dive the effective tilt eases
    from the slider value toward top-down (`currentTilt` in frame(), driven
    by ZOOM progress not time; easeInExpo (normalized 2^(10(p−1))) so the
    whole descent lands in the final stretch of the zoom — the earlier
    smoothstep-by-75 % version read "too literal, too soon" per user). Floor = 60 % of slider tilt (~44°; was 40 % — full-ish descent read forced, user): full top-down
    forfeits the oblique stretch that keeps distant stars in frame, so the
    hole swallowed the view early and ate the flare finale (tried 12 % —
    late dive went black). Uploaded per frame; sync() uploads currentTilt
    too so paused repaints keep the dive tilt; fade phase resets behind
    black. Side effect: the finale reads as a symmetric star tunnel around
    the void. (Init-order gotcha: currentTilt must be declared before the
    first sync() call — TDZ killed the whole page once.)
22. **Depth-ramped rotation during the dive** — the late dive looked like
    rotation stopped: the haze/arms that make spin readable are extinct by
    then, a uniform swarm is nearly rotation-invariant, and the radial rush
    swamps the constant tangential speed. The dive's rotation clock now
    ramps `5× → ~20×` with depth (`× (1 + 3·(1−zoom)³)`, Kepler-flavored).
    shaderTime only drives the spin angle, so the ramp is safe; twinkle
    keeps its own wall clock.
23. **Closer framing + far-field early-out** — framing constant 2.0 → 1.65
    (`camD`; galaxy ~20 % closer at rest, trimming dead space; JS uPxSize
    recalibrated 4.0 → 3.3 to match). New early-out right after the plane
    hit: past `rCut = 2.5 + 0.25·uDiskThickness` (all body falloffs are
    sub-quantization there) or above the horizon, output = bg stars +
    dither only — skips both smokeMaps and every star lattice. Radially
    coherent branch; measured ~26 % faster rest frame (SwiftShader).
24. **Nebula occlusion of stars — tried and REVERTED** (`uNebulaDim`, stars
    dimmed by local smoke density). User verdict: dimming stars is not an
    option — it kills the sparkle and reads grayish. Constraint for any
    future "more nebula definition" attempt: star brightness is
    untouchable; work on the haze side instead (more smoke contrast/
    brightness, dust-lane structure inside the SMOKE term, or color
    separation between haze and stars).
25. **Dust filament warp — REMOVED** (was `uDustWarp`, ported from the
    V2.0 study's domain-warped dust). It sheared fbmdust/fbmdisk along the
    orbital tangent into wispy strands, but the effect sat UNDER the
    star-packed arms and read as no visible difference (that's what drove
    the gas-cloud layer, item 26, as the over-the-disk alternative). Once
    the gas clouds landed, the dust warp was dead weight, so the user had
    it removed entirely (this pass): the `uDustWarp` uniform, its slider,
    all JS wiring, and the warp block are gone; `smokeMap` is back to its
    2-arg `(ps, pd)` form sampling the unwarped frame. Removal is
    pixel-identical to the previous state (dust already defaulted to 0, and
    0 was the unwarped math — verified 0 differing bytes). NOTE: this
    dropped a float uniform from the middle of the list, so every Flutter
    index after uHazePulse shifted down by one (total 53 → 52 floats); the
    FLUTTER_IMPLEMENTATION.md table was regenerated and cross-checked
    against galaxy.frag's actual declaration order. (The base `fbmdust`
    noise and the "dust/disk" nebula texture are unrelated and untouched —
    only the domain-WARP feature was removed.)
26. **Gas clouds layer** (`uGasClouds`, "Gas clouds" slider 0–1, default
    0.5) — the working answer to "nebula masked by stars" (reference
    video's gauze): a sparse second layer of soft fog banks floating OVER
    the disk, deliberately NOT arm-masked, so the banks wash out over the
    star-packed arms but read clearly in the dark winding gaps — visibility
    from placement, star brightness untouched (item 24 rule). Motion
    (round 5, "after a minute it looks caught up to speed — too much,
    keep the look the same throughout"): round 4's differential rotation
    used a lag that GREW LINEARLY WITH TIME with no ceiling
    (`lag·uRotSpeed·iTime`, lag itself radius-dependent) — harmless-looking
    for the first few seconds, but over a minute+ it keeps accumulating,
    so inner and outer gas wind up at ever-larger relative angles and the
    pattern visibly shears itself into a different, tighter-wound look the
    longer the tab stays open. Fixed by splitting what the time-varying
    term is allowed to touch: the streak BAND POSITIONS now sample
    `atan(pOval.y, pOval.x)` directly — the un-lagged, non-accumulating
    frame — so the bands stay locked in the winding gaps forever, no
    matter the runtime. Only the WAVE TEXTURE inside the bands (nw/n2,
    still sampled at a `pc` frame carrying a small constant angular
    offset `wind = 0.10·smoothstep(0.2,1.3,r)` — fixed, not time-scaled —
    plus a small rigid `0.05·uRotSpeed·iTime` lag and the counter-crawling
    `wDrift` taps) keeps moving — turbulence/shimmer stay alive, but
    bounded, since nothing left has an unbounded growth term. Verified: 3
    minutes of fake-clock runtime, shape reads the same as at t=0.
    Pattern (round 3, "flow with the windings"): the streaks use the SAME
    log-spiral phase family as arm() — identical theta/spacingWarp math,
    `band = smoothstep(-0.4, 0.85, sin(ph))` with
    `ph = (theta(spacingWarp(r)) − t)·uArmCount + 1.6·nw` — so the clouds
    run parallel to the actual windings. `nw` = average of two rotated
    low-freq noise taps (single taps read as zigzag herringbone — the
    sin-basis chevrons; averaging cancels them) and bends the edges into
    long soft waves; a breakup threshold dissolves the coil into patches;
    one fine mottle tap textures the inside. Disk envelope
    `smoothstep(1.35, 0.95, r)·smoothstep(0.10, 0.40, r)` — offset well
    INSIDE the spiral (rounds 2+4: "don't need gases outside; the beauty
    of the tapered spiral end goes away"): the gas lives between the
    windings and is fully gone before the outer arm taper. Tinted
    per mode (uOuterHazeColor / uNormalHazeColor·0.85), added BEFORE the
    core mix so the hole punches through; rides uHazePulse for the
    come-alive beat. Fades out mid-dive, EARLIER than the main haze:
    `cloudVis = smoothstep(0.32, 0.55, uZoom)` (gone ~70 % into the zoom
    while haze holds to 0.18); uniform gate skips everything when extinct
    or at 0 — bit-identical off (verified 0 differing bytes), perf flat
    within SwiftShader noise.
27. **Flutter sync shipped** (user said the word). Three files, all
    generated from the editor's shader body VERBATIM (extracted between
    the `const shaderBody = \`` backticks — regenerate the same way after
    any editor change):
    - `galaxy_shader_V1.3.glsl` — replaces/renames V1.2; header + body,
      Shadertoy-style (iResolution/iTime host-provided).
    - `galaxy.frag` — Flutter FragmentProgram port: `#version 460 core`,
      `#include <flutter/runtime_effect.glsl>`, declares iResolution +
      iTime, body verbatim, `main()` flips fragCoord.y (body is y-up).
      Validated with glslangValidator (include stubbed). 53 float slots.
    - `FLUTTER_IMPLEMENTATION.md` — uniform float-index table (order =
      declaration order in galaxy.frag; do not reorder), the two-clock
      rule (iTime dive-accelerated vs uTwinkleTime wall), full dive
      choreography as a Dart driver (pulse curve, linear zoom, hold,
      fade-with-hidden-swaps), tilt-descent + uPxSize formulas, defaults
      for both palettes, perf notes (DPR lever, uniform-gated features).
