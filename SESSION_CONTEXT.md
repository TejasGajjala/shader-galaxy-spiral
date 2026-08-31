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
uArmCount 2 · uArmWinding 17.0 · uArmSpacing 1.12 · uArmFalloff 0.12 · uArmSpread 0.55 · uArmEdgeSkew 0.6
uArmSmoke 0.82 · uCoreGlow 1.0 · uCoreGlowSpread 0.83 · uCorona 0.80 · uGasClouds 0.16 · uBulge 1.5
uDiskThickness 1.35 · uFlare 0.6 · uOvalness 1.02 · uCamTilt 1.27 · uRotSpeed 0.05 · uCompactness 1.74
uStarDensity 3.48 · uMaxStarLod 2.0 · uTwinkleFraction 0.14 · uTwinkleSpeed 0.0
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
28. **Background starfield — REMOVED** (`bgStarField`, the sparse ~15
    distant stars scattered outside the disk). Reviewed via a temporary
    editor-only `uBgStars` checkbox, then deleted at the user's call
    ("not making a huge difference visually"): the function and BOTH call
    sites (main path + far-field early-out, which now emits only dither)
    are gone, along with the whole toggle scaffolding. The galaxy body is
    pixel-identical (only the specks change; verified 177 differing bytes
    vs the with-bg build). Surprisingly costly for its size — it ran a
    3×3 hash lattice on EVERY pixel (sky and galaxy), so removing it saved
    ~74 ms/rest-frame on SwiftShader (~15 %; far less absolute on a GPU
    but still a real per-pixel win). No uniform was removed (it used the
    shared uPxSize/uTwinkle*), so the Flutter float-index layout is
    unchanged — deliverables re-synced, index table untouched, 52 floats.

## Perf audit (SwiftShader, rest frame, marginal cost of each element)

Ranked heaviest → lightest at the current defaults (disk thickness 1.35,
so the thick star path is live). Absolute ms are software-raster; ratios
transfer (all ALU, no textures):
1. **3D disk thickness** ~100 ms — thick path evaluates arm+bulge stars
   across 2 height sheets each + 2 floater sheets (~8-10 lattice passes
   vs 2 flat).
2. **Nebula smoke** (`uHaze`) ~99 ms — TWO smokeMap() calls/pixel (body +
   b glow), each fbmdust(6)+fbmdisk(6)+fbmabs(8) noise taps + arm() math.
3. **Bulge stars** (`uBulge`) ~33 ms.
4. **Gas clouds** (`uGasClouds`) ~15 ms.
5. **Star density** (`uStarDensity`) ~8 ms marginal.
6. **Twinkle** ~6 ms.
- Dive-only spike: **LOD cross-fade** (star refill ~zoom 0.6→0.25) is the
  single most expensive frame — ~2× rest (doubles the star pass);
  `uMaxStarLod` is the lever. Flares cost ~4 ms (negligible).
- Levers if mobile struggles: DPR drop during the dive; lower
  `uMaxStarLod`; flat disk (thickness 0) reclaims ~100 ms; the `b` glow
  smoke layer is a candidate to cheapen (smoke is 2× smokeMap).

29. **Perf pass: merged star populations + core-hole skip + glow trim**
    (user-approved options 1/2/5 from the audit brainstorm; all verified
    against the 8-state pixel-identity harness).
    - *Merged star pass (flat path)*: `starFieldLevel`/`starField` now
      return `vec2(.x = full population, .y = keep subset)` from ONE
      lattice walk; the flat path combines them with the exact old
      expressions `max(starMask*sf.x*1.5, sf.y*1.5*0.8)`. First attempt
      folded the weights per star INSIDE the walk — bit-identical at rest
      but NOT through the LOD cross-fade (`max(mix,mix) != mix(max,max)`
      when the winning star switches levels; caught by the harness, max
      delta 6/255). The vec2 form mixes each population across levels
      independently, exactly like the old two passes: 0 differing bytes
      on all 8 states. Sheet callers pass `wantAll = 0` and read `.y`
      (old early-skip behavior, unchanged cost).
    - *Core-hole early skip*: inside `length(p) <= uBlackHoleSize *
      mix(0.45, 0.85, uCoreMode)` the CORE mix saturates at coreMask == 1
      and discards every body term, so smoke/gas/stars are skipped
      outright (`inHole`). Same `length(p)` expression the CORE section
      feeds smoothstep, so the boundary pixel is identical.
    - *Glow trim*: the `b` layer runs `smokeMapGlow` = smokeMap with
      `fbmabsG` (6 octaves, was 8). The ridged fbmdust/fbmdisk stacks are
      NOT reducible (dropping an octave moves ridge lines — measured up
      to 32/255 at one octave off); fbmabs truncation only removes the
      two finest terms (drift feedback is forward-only): measured max
      delta 1 LSB, zero pixels above 1 LSB — below the shader's own
      dither.
    - Measured (SwiftShader, 480×1000, pinned zoom): flat rest −20%,
      flat LOD-blend −31%, deep dive z0.02 −14%, **hold frame −70%**
      (hole covers the screen), thick rest −2% (thick sheets untouched
      by the merge — only the glow trim applies there).

30. **Host frame pacing at rest documented** (option 3 of the perf
    brainstorm) — FLUTTER_IMPLEMENTATION.md §8 now tells the app to paint
    30 fps at rest / 60 fps while diving (rest motion is only the
    0.05 rad/s spin; scheduling, not rendering — zero per-frame change).
    Option 4 (collapse thick-path sheets where parallax is sub-pixel) was
    investigated and REJECTED: at defaults the sheet offsets are ~5 px
    (arms) / ~16 px (bulge) on screen — they ARE the visible 3D rim, and
    they only grow in pixel terms during the dive (footprint shrinks with
    zoom while parVec doesn't). Per-star offsets in one walk stay
    impossible (offsets exceed the sub-cell clamp ~16×; the item-15 trap).
    The ~100 ms thick-path cost is the price of the look, not waste.
    Also fixed §9's palette index ranges, stale since the uDustWarp
    removal renumbering (boom 27–38, normal 39–50).

31. **Ease-in-out zoom** (user: "starts slower, gets into a bit of speed,
    then slows down again"). The dive zoom now blends a smoothstep S-curve
    into the linear progress: `pz = p + (smoothstep(p) - p) * ZOOM_EASE`,
    `currentZoom = 1 - pz`, with `ZOOM_EASE = 0.75` (one tunable constant
    by the PULSE/duration block). Endpoints and the 5 s duration are
    exactly preserved (p=0→zoom 1, p=1→zoom 0.0001); only the pacing
    eases: ~0.25x velocity off the mark and into the finale, ~1.4x through
    the middle (verified by sampling the profile — clean symmetric S).
    Rotation ramp and tilt descent read currentZoom, so they breathe with
    the same curve automatically. NOTE this supersedes the earlier
    "keep it linear" call (old item 13 / the rejected curve) — but that
    rejection was of an ASYMMETRIC ease (fast start, slow end); this is a
    symmetric ease-in-out, a different shape the user asked for directly.
    0 = linear if ever wanted back. Choreography-only (JS + the Dart
    driver in FLUTTER_IMPLEMENTATION.md); shader body unchanged, so
    galaxy.frag / V1.3 did not regenerate.

32. **Nebula haze split into four sliders** (user request; central glow got
    its own slider per user pick). `uHaze` is GONE, replaced by:
    - `uArmSmoke`  — arm filament smoke (smokeMap .x)
    - `uCoreGlow`  — broad nucleus haze (smokeMap .y; the old glowTerm)
    - `uGlowLayer` — the soft secondary `b` layer (smokeMapGlow)
    - `uCorona`    — tight core bloom (BOOM MODE ONLY, as it always was)
    smokeMap now returns vec2(armTerm, glowTerm); mainImage combines
    `hazeMod·max(uArmSmoke·x, uCoreGlow·y)` where `hazeMod = hazeVis ·
    uHazePulse` (the shared dive extinction + pulse ride on ALL four).
    All four default 0.80 == the old uHaze 0.80 look (verified: 8-state
    harness 0 differing bytes except one ±1 LSB pixel from float
    reassociation). Corona stayed boom-only after a both-modes attempt
    washed the normal-mode dive finale (the visible zoom runs in normal
    colors; at deep zoom exp(-25 r²) covers most of the screen — caught
    by the harness, reverted). LAYOUT CHANGE: 1 float became 4 at index
    10, so every Flutter index after uArmSpacing shifted +3 (52 → 55
    floats); FLUTTER_IMPLEMENTATION.md table + prose regenerated and
    cross-checked against galaxy.frag. Copy/apply block now carries the
    four in place of uHaze.

33. **Low-battery / power-saver ladder documented** (user hit perceived
    lag that turned out to be OS low-battery throttling, not a shader
    regression). FLUTTER_IMPLEMENTATION.md §9: detect via battery_plus
    (prefer the OS battery-saver FLAG over raw %), then apply in order —
    (1) frame pacing 30→24 fps rest / 60→30 dive, (2) uGlowLayer = 0
    (~10 % rest frame back, skips one smoke pass), (3) DPR cap 2.0/1.5,
    (4) uDiskThickness = 0 (flat path, ~20 %), (5) uMaxStarLod = 1
    (flattens the mid-dive LOD spike). Never dim stars. Also documented
    that haze-slider cost is per-layer on/off (post-multipliers; only
    exactly 0 trips the skip; ArmSmoke+CoreGlow share one gate).

34. **Bulge concentrated at the center** (user + reference image: the core
    cluster should be as packed as the arm roots, ours was an even wash).
    Presence profile in BOTH star paths: `min(uBulge · 2.4 ·
    exp(-r² · 7.0), 1.0)` (was `uBulge · exp(-r² · 3.2)`). The 2.4 gain
    SATURATES keep to 1 near the center at the 0.5 default (fully packed
    cluster; before, the center itself only kept 50 %), and the sharper
    exponent kills the mid-disk tail (r = 0.7 scatter: 10 % → 4 %).
    Semantics shift: uBulge now mostly grows the RADIUS of the saturated
    cluster rather than the center density. Slightly faster too (bKeep
    gate skips the bulge lattice over more of the disk). Deliverables
    re-synced; no uniform/layout change.

35. **Core glow spread control** (`uCoreGlowSpread`, "Core glow spread"
    slider 0.4–2.0, default 1.0). Decouples the core glow's radial REACH
    from its intensity: the spread divides both glow gaussians' exponents
    (`gInv = 1/spread²`) so the falloff widens/tightens while the peaks —
    and therefore the center brightness — stay pinned (a gaussian's peak
    is independent of its width). Scoped to smokeMap's glowTerm only; the
    secondary glow layer's own central blob is untouched. 1.0 is exactly
    the multiplier 1 → bit-identical (verified 0 bytes across the 8-state
    harness). LAYOUT: +1 float at index 12, everything after shifts
    (55 → 56); table + prose regenerated and cross-checked.

36. **Arm star spread — plateau rebuild** (`uArmSpread`, stars only).
    Widening the band by LOWERING the profile exponent works, but the
    same exponent also sets the profile's floor (0.739^k): dropping it
    lifted the inter-arm floor and flooded the gaps (measured +21 % stars,
    1712 lit gap pixels at full spread). Pinning the floor back down then
    cancelled most of the widening — the slider degenerated into a dimmer
    (user: "arm spread now does nothing except dimming"). Fixed by
    changing the MECHANISM: the falloff is pushed OUTWARD by W radians,
    giving a flat full-brightness plateau of half-width W with the
    original edge steepness intact on both sides. Width and edge
    sharpness are now independent, and the floor barely moves.
    - `ARM_SPREAD_COMP` (0.60) thins the population in proportion to the
      widening, so spreading REDISTRIBUTES stars instead of breeding them.
      Calibrated empirically over four values (analytic first guess
      over-thinned by 18 %).
    - Measured: arm half-width 50° → 72° (1.44×), lit gap pixels
      1712 → 92, total star count within ±3 %.
37. **Arm edge skew** (`uArmEdgeSkew`, stars only) — one-sided falloff:
    hard inner edge, feathered outer, the density-wave look (gas shocks
    on the upstream edge, material trails downstream). The crest sits
    where the normalised base == 1 and 1^k == 1 for ANY k, so the two
    flanks run different exponents and still meet with continuous value
    AND slope (the profile is quadratic-flat at its peak) — no seam, no
    clip. Area-preserving pair: 1/sqrt(sIn) + 1/sqrt(sOut) == 2.
    Inner/outer sign verified numerically (phase decreases with radius in
    2000/2000 samples) — do not flip it blind. Measured flank ratio
    0.75 → 1.67. Adds no stars (gap brightness unchanged).
38. **Haze secondary glow REMOVED** (`uGlowLayer`, `smokeMapGlow`,
    `fbmabsG` all deleted) at the user's call after A/B'ing it — drops a
    full smoke pass per pixel (~10 % of the rest frame). Consequence:
    `uOuterHazeColor` now tints only the corona and gas clouds, and the
    battery-saver ladder's step 2 changed accordingly.
39. **Snapshot button** — camera icon in the phone frame renders one
    frame at up to 3× (4096 px cap) and shows it in an overlay to save
    manually. The sandboxed artifact webview blocks anchor downloads, so
    the direct download is best-effort only; the overlay always works.
40. **Sync pass** — deliverables regenerated from the editor body
    verbatim; galaxy.frag re-validated with glslangValidator; the Flutter
    index table rebuilt programmatically from galaxy.frag's declaration
    order (58 floats — layout shifted: uGlowLayer removed, three arm
    uniforms added, boom palette now 33–44, normal 45–56).

41. **Edge skew rebuilt for real strength.** The width plateau now LEANS
    with the skew (Wout+Win stays 2W; trough baseMin taken per side), and
    the exponent pair widened 0.7 -> 0.85 with the blend narrowed to
    +-0.3 rad -- at +-0.8 the flank never reached its exponent before the
    arm had already faded. Flank ratio at spread 0.55: 1.77x -> 15.1x.
42. **uSmokeSkew** -- the star arms' skew for the SMOKE arms (own slider,
    no width plateau, same 0.85 pair, trough-pinned so gaps hold and the
    two flanks meet seamlessly mid-gap). Both arm() terms route through
    smokeProfile(); bit-identical at 0.
43. **Arm-length relationship REVERSED** (user call): smoke taper
    shoulder 1.15 -> 1.0 coeff 3 -> 10 (sheet dies ~1.25-1.30, veil black
    by ~1.45); star taper shoulder 1.15 -> 1.25 coeff 6 -> 3 (bright to
    ~1.50, speckle ~1.60). The outer ~0.25 r of star arms sits on plain
    black. Gas already died by ~1.3, unaffected.
44. **Gas cloud gain halved** (0.55 -> 0.275): full slider now equals the
    old halfway point. Values/ranges unchanged.
45. **New hand-tuned defaults** (user-dictated): winding 18.5, falloff
    0.70, spread 0.61, edgeSkew 1.0, smoke 0.74, smokeSkew 0.5,
    glowSpread 0.74, gas 0.22, flare 1.0, ovalness 1.05, tilt 1.26,
    rotSpeed 0.036, compactness 1.88. Ranges widened for hand tuning:
    coreGlowSpread min 0.4 -> 0.3, starDensity max 4 -> 5.
46. **Core glow centred**: the tight second gaussian sat at a fixed 0.2
    offset in the ROTATING frame (V1 relic) -- a bright blob slowly
    orbiting the hole, obvious once glowSpread tightened. Offset dropped;
    centroid now time-invariant.
47. **Two-papers fix**: arm-slab height tapers with plane radius
    (hEnv = 1 - 0.85*smoothstep(1.0, 1.5, r)) so the two height sheets
    converge across the naked rim where their footprints separated by
    ~0.4 r at high tilt. Bit-identical inside r = 1.0. Bulge/floaters
    keep full height by design.
48. **uArmWobble** -- static noise warp on the arm phase (no time term,
    rotating-frame sample: spins rigidly, cannot crawl or re-wind).
    Radius-ramped amplitude, ~0.7 rad max. Stars and smoke share the
    field. Default 0, bit-identical, zero-cost gate.
49. **uRimCoarse** -- outermost star band (past r = 1.0, after falloff's
    ramp ends): thins the population (0.60 max) AND stretches the
    envelope outward (armRadialFade shoulder 1.25 -> 1.70, falloff
    3.0 -> 1.1), so survivors scatter further out instead of stopping at
    the same edge. First cut only thinned -- at 0.80 removal the
    1.4-1.6 band came out BELOW baseline and nothing reached further.
50. **Dive verification pass** (all recent work, shipped defaults and
    wobble 0.6): glow centroid pinned through the approach, no sheet
    doubling, naked rim clean under magnification, choreography timeline
    intact, flares wake in the final stretch, boom-palette fade-back
    correct. Late-dive star size approved by the user as-is.
51. **Three rejected experiments, all reverted clean** (verify
    bit-identity when reverting -- it caught nothing left behind each
    time): (a) uCoreCluster second lattice at the nucleus -- user: no
    extra layers; (b) uSmokeCore inner-arm smoke flare -- "doesn't look
    that great"; (c) armStarKeep dense-head/knee/tail curve
    (1 - f*(1 - exp(-2.2 r^1.7))) -- "not too great". Lesson: the centre
    runs at keep = 1 (saturated), so concentration ideas can only THIN
    the surroundings, which keeps reading as a sparser galaxy, not a
    richer core. The only true adder is uStarDensity.
52. **Smoke is NOT saturated across the inner disk** (correction of an
    in-session claim): its pre-colour term exceeds 1 but feeds the colour
    pipeline, so rendered crest runs ~83 -> 34/255 across the disk
    (~2.5x) -- the arms genuinely read as evenly lit gas. Any future
    "bright arm roots" work starts from that fact.
53. **Perf state**: rest frame grew ~9 % since item 40's checkpoint
    (SwiftShader medians 344 -> ~375 ms; real-GPU cost will be smaller).
    No single feature is responsible -- toggling edge skew, smoke skew,
    spread, falloff, or gas each changes nothing beyond noise; it is the
    sum of small always-on additions in the mask functions. The
    user-perceived "sudden lag" is more likely environmental (battery /
    thermal / tab DPR), as in the earlier battery incident.
54. **Sync pass 2** -- deliverables re-spliced verbatim from the editor
    body; index table regenerated from galaxy.frag declaration order:
    **61 floats**, uRimCoarse 13, uArmWobble 14, uSmokeSkew 16, boom
    palette 36-47, normal 48-59, uCenterSpread 60. Three stale comments
    crediting the dissolution to uArmFalloff corrected to uArmSpread.

55. **Aspect correction added.** `p = 2*fragCoord/iResolution - 1`
    normalised BOTH axes independently, so the scene stretched to whatever
    shape the canvas was: same uniforms gave galaxy w:h 1.53 at 9:19.5,
    1.32 at 1:1, 2.19 at 16:9, and a square canvas flattened it AND
    overflowed both edges. Corrected RELATIVE to the authoring canvas
    (392x840 -- the phone frame MINUS its 14px border; using 420x868 was
    wrong and broke identity) via `p *= vec2(max(f,1), max(1/f,1))`,
    f = aspect/REF. Identity at 392:840 (verified bit-identical);
    "contain" semantics elsewhere so nothing overflows. Reads as a
    camera-tilt bug because a flattened disk is what steeper tilt looks
    like -- check iResolution first, never uCamTilt.
56. **Copy block now emits the SEVEN host-driven uniforms as comments**
    (iResolution, iTime, uZoom, uFade, uColorTransition, uHazePulse,
    uPxSize) with rest-state values, plus the authoring canvas size. They
    were never in the block (not sliders), so anyone pasting it into
    another renderer had to guess all seven -- the root cause of a whole
    list of integration mismatches reported from another webview.
    uColorTransition is emitted with the CURRENT mode called out, since a
    normal/boom mismatch is the single biggest visual difference.
    applyGlslText ignores comment lines, so paste-back round-trips (36
    values, block byte-stable).
    NOTE: glslText() runs during the FIRST sync(), which happens before
    `let currentZoom` is initialised -- reading it there throws a TDZ
    ReferenceError and leaves the textarea empty. The block documents the
    REST state, so use the literal 1.0 (and state.camTilt) instead.
57. **Integration mismatches reported from another webview**, triaged:
    real and ours = none beyond the two above; real and theirs = uPxSize
    derived from the wrong axis (our doc SS7 already had the worst-axis
    formula), iTime fed as wall-clock seconds (fine at rest, breaks the
    dive); deliberate app choices = uFade x vitality 1.1/0.45, fragCoord
    offset putting the core at 36% height, bottom vignette 0.9, scroll
    fade to 10%; non-issues = uZoom/uFlare at 1 (flares only wake below
    uZoom 0.22), DPR cap 2, antialias:false.
58. **Doc**: added an "Authoring aspect" section under the index table and
    a blockquote warning that iTime is NOT wall-clock (accumulate
    `shaderTime += dt * rotationRate`; sampling an absolute clock looks
    right at rest and freezes the late dive).

## Dev environment gotchas (added this round)

- A GLSL helper must be DECLARED before first use: moving `armWiden`
  below `armStarKeep` compiled to "no matching overloaded function" and
  the canvas still rendered (stale program), so a screenshot alone does
  NOT prove a shader compiled — check the browser console for errors.
- Session interruptions have silently rolled the working file back mid-
  edit at least once. Grep for a distinctive token from the change before
  publishing or committing.
- The artifact publish endpoint has been refusing UPDATES to existing
  artifacts (403 on its verification read); publishing to a fresh file
  path mints a new URL and works.
- The artifact endpoint also returns "another session published a newer
  version" conflicts on a URL only this session has ever published to.
  Publishing to a fresh file path is the non-destructive resolution --
  do NOT force, which would discard whatever is actually there.

## Item 59: Disk thickness rendered as separated plates (the real cause)

**Reported:** at `uDiskThickness = 4.20` with bulge stars at 0, each arm
rendered as two distinct copies -- "there is a layer where the stars are not
getting dispersed at all, they're stuck to the layer." Suspicion was on the
newly-added `uArmEdgeSkew` / `uRimCoarse`.

**Not those.** Both are angular/density masks; neither can open a vertical
gap. The thick path has two independent height mechanisms and only one of
them scaled with the slider:

| mechanism | magnitude | scales with slider? |
|---|---|---|
| sheet offset (macro) | `hDisk = T * 0.008` | yes, linear, uncapped |
| per-star sub-cell fuzz (micro) | `hh * min(T, 1.0) * 0.004` | **saturates at T = 1** |

The population is split across sheets at exactly `+hDisk` / `-hDisk`, and the
fuzz is the only thing that fills between them. So:

- T = 1.0 -> sheets +/-0.008, fuzz +/-0.004: gap 0.008, sheets 0.008 thick. Reads fuzzy.
- T = 4.2 -> sheets +/-0.0336, fuzz still +/-0.004: **gap 0.059, sheets 0.008 thick** --
  the vacuum is ~7x the sheets themselves. Two plates.

Visible on arms and not the bulge because arms are thin ridges (doubling is
legible) while the bulge is a diffuse gaussian blob (doubling is not) -- which
is exactly what was observed.

The fuzz cannot be widened to cover it: `starFieldLevel` offsets each star
from its own footprint, so the 3x3 lookup caps the shift sub-cell. That cap is
*why* it saturates.

**Fix:** scale the sheet COUNT instead of trying to widen the fuzz. Sheets
spread evenly across [-h, +h] with the partition hash window tiling [0,1) N
ways, so the star count is conserved -- thickening redistributes the same
stars through the slab rather than breeding them. `N = clamp(floor(1 + T), 2, 6)`
holds sheet spacing near its T = 1 value at any thickness. T <= 1.35 (the
default) still resolves to exactly 2 sheets, so the default look is
bit-identical and costs nothing; only a cranked slider pays for extra sheets.

`uDiskThickness` is a uniform, so N is the same for every pixel and the loop
stays fully coherent. Constant bound + `break` rather than a dynamic bound:
the editor is WebGL1 (GLSL ES 1.00), which forbids non-constant loop bounds.

**Reverted in the same commit:** the earlier `hEnv` 0.85 -> 0.50 change from
this session. That was a misdiagnosis -- it *widened* the rim gap (keeping
more sheet height exactly where the sheets were already separating), so it
made the reported symptom worse. Back to 0.85, whose rim-collapse job is real
and complementary to the N-sheet fill.

**Caveat:** committed WITHOUT a render check (session was low on credits, user
verifying manually). Statically reviewed for ES 1.00 legality and confirmed no
dangling `sgn` reference, but per the gotcha below a stale program still
renders -- if the canvas looks unchanged, check the console for a compile error
before assuming the math is wrong.

## Item 60: Continuous slab heights (parallel paths in the 1-3 range)

**Reported:** the item-59 N-sheet fix only helps at high thickness; in the
working range T = 1-3 each arm still reads as two parallel paths.

**Why item 59 fell short:** N = floor(1 + T) resolves to just 2-3 sheets
across 1-3, and the between-sheet filler was still the old independent
fuzz, which saturates at T = 1 (min(T,1) * 0.004) -- and is further cut by
the sub-cell clamp (0.45/GRID plane units; at the default tilt's parVec ~3
the effective fuzz height is ~0.002). Sheets at +/-0.008T with ~0.002 of
blur = thin plates with vacuum between, exactly at the default.

**Fix (structural):** derive each star's height FROM the partition hash.
The hash window that deals a star to a sheet, rescaled within that window,
is the star's continuous height inside the sheet's slice of the slab;
sheet frames sit at slice CENTERS and the residual (up to half a slice)
rides the sub-cell offset. Residuals of one sheet reach exactly to the
neighbouring sheet's, so the height distribution is uniform across
[-h, +h] by construction -- repeated strips cannot form at any thickness.
The old independent fuzz hash (17.9, 61.3) is gone; starFieldLevel /
starField take a `resid` param (0 on the flat path, hDisk/N or hBulge/N on
the thick path).

N = clamp(ceil(2T), 2, 8): where the sub-cell clamp truncates residuals
(far field), sheet pitch stays within ~2 star spacings -- below what the
eye can group into rows. Cost now scales with the slider: default 1.35
runs 3 sheets (was 2), T = 3 runs 6, cap 8. Flat path T = 0 stays
bit-identical. hEnv rim taper unchanged (scales pitch and residuals
together).

Verified in headless Chromium: compiles clean, and canvas captures at
T = 1.35 (default), 2.0 and 3.0 (bulge 0) each show one fuzzy band per
winding -- no parallel paths. Commit is this one; synced across all three
shader files (bodies byte-identical before and after).

## Item 61: Load re-audit at the production defaults (design sign-off)

New defaults landed in c936c8a (11 values; twinkle now OFF by default).
Re-measured marginal costs on SwiftShader, 392x840, rest frame, normal
mode -- absolute ms are software-raster, the RATIOS are the guide:

| config                      | ms/frame | marginal vs base |
|-----------------------------|----------|------------------|
| base (new defaults)         | 352      | --               |
| thickness 1.00 (2 sheets)   | 287      | 3rd sheet +64    |
| thickness 3.00 (6 sheets)   | 512      | ~+53/sheet       |
| thickness 0 (flat path)     | 163      | thick path = 54% of frame |
| bulge 0                     | 328      | bulge sheets 24  |
| smoke + coreGlow 0          | 319      | smoke stack 32   |
| gasClouds 0                 | 348      | 4                |
| corona 0                    | 352      | ~0               |
| floor (all of the above 0)  | 149      |                  |
| DIVE mid (LOD cross-fade)   | 418      | +19% over rest   |

Shifts since the item-29 audit: the smoke stack fell from ~99 to ~32
(glow trim + scale), and the DISK-THICKNESS SHEET LOOP is now the whole
story -- 54% of the rest frame (3 arm walks + 3 bulge walks + 2 floater
walks vs 1 flat walk), with each sheet costing ~53 (lattice walk + its
own arm mask). The continuous-slab fix (item 60) added the 3rd sheet at
the default: +64, +18% -- the price of the filled slab the design team
approved. The dive is no longer the spike it was (+19% vs the old 2x):
rest-frame cost is the production load story.

New defaults themselves are perf-neutral vs the previous set (twinkle 0
saves its hash-class cost; gasClouds 0.43 vs 0.15 changes nothing --
haze layers cost by on/off, not value; starDensity is not a walk-cost
lever).

Ranked levers (none applied yet):
1. Resolution cap on the host -- THE lever. 392x840 CSS on a 3x phone is
   ~3.0 Mpx, 9x the bench. Render the FragmentProgram at <=2x DPR or a
   fixed ~1-1.3 Mpx budget and upscale (the editor itself ships
   MAX_BACKING_PX = 2.2 Mpx as precedent). Fraction saved ~= fraction of
   pixels not shaded.
2. Frame pacing at rest (already documented, FLUTTER_IMPLEMENTATION §8):
   30 fps at rest / 60 in dive; rest motion is a 0.036 rad/s spin.
3. Shader-side sheet-loop trims, in descending value / ascending risk:
   share the arm mask across sheets when sheet offsets are sub-arm-width
   (saves ~2 mask evals, est. -4-5% frame); thin the bulge to 2 sheets
   (bulge is diffuse, est. -8 max, visual risk low but nonzero). Each
   needs the pixel-identity harness before shipping.
4. uMaxStarLod = 2 already caps the dive refill; leave it.


## Item 62: Dive is now mode-neutral, 6.0 s, 40 deg tilt floor

User-directed refinement ahead of production:

- **Mode swap removed from the dive.** `transitionTarget` is retired and
  `startTransition(toBoom)` is now `startDive()`. The dive returns to the
  view it began in; `uColorTransition` / `uCoreMode` are owned solely by
  the Normal/Boom buttons.
- **Timeline 8.2 s -> 6.0 s.** PULSE 1000 unchanged, zoom `duration`
  5000 -> 4000 (zoom ends at 5.0 s from the tap), HOLD 700 -> 1000 (core
  beat holds to 6.0 s). The 1500 ms fade-back phase is DELETED.
- **Tilt floor is now an absolute 40 deg** off top-down (was 60% of the
  slider, ~43.3 deg at the 1.26 default), clamped to the slider so a
  resting tilt already below 40 deg is never tilted UP by the dive.

Consequence, accepted by design: with no fade there is no black to hide
the reset, so zoom (0.0001 -> 1.0) and tilt (40 deg -> 72.2 deg) snap home
in a single visible frame. Fine when the dive navigates away; needs an
app-level cover otherwise.

`uFade` is now never driven by the editor's dive (constant 1.0). The
uniform stays in the shader and the index table for host use -- do NOT
remove it, the float layout is fixed.

Recorder clip length follows: DIVE 8200 -> 6000 (total clip 7.8 s).

Verified in headless Chromium: dive measured 6095 ms on the page's own
clock (6000 + one software frame); mode and button label unchanged across
a dive; no console errors. FLUTTER_IMPLEMENTATION.md section 5 (phase
diagram + Dart driver), section 6 (tilt), the uFade row and the mode
cheat-sheet all updated to match.

## Item 63: Second load audit (post-dive-rework, production defaults)

SwiftShader, 392x840 (0.33 Mpx), rest frame 400 ms base. Marginal costs by
toggle (ratios are the signal, not the ms):

| what                                   | ms  | % of frame |
|----------------------------------------|-----|------------|
| whole thick-path machinery (T=0 diff)  | 213 | 53%        |
|   - machinery at ~zero height (T=0.05) | 121 | 30%        |
|   - 3rd sheet (1.35 vs 1.00)           | 71  | 18%        |
|   - bulge sheet walks (bulge 0)        | 30  | 7.5%       |
|   - per extra sheet (curve to T=3)     | ~59 |            |
| smoke stack (armSmoke+coreGlow off)    | 34  | 8.5%       |
| arm wobble (0.19 -> 0)                 | 22  | 5.5%  NEW  |
| gas clouds                             | 16  | 4%         |
| corona                                 | 14  | 3.5%       |
| floor (all off; ray+flat walk+masks)   | 155 | 39% irreducible-ish |

Sheet-count curve is linear (~59 ms/sheet): 2 sheets 329, 3 = 400,
4 = 456, 6 = 566. The thick machinery costs 121 ms BEFORE any height
shows (T=0.05): 2 arm + 2 bulge + 2 floater walks replacing 1 flat walk.

Dive per-frame cost by zoom band (2 runs, deep bands are 1-2 frames --
approximate): pulse 354; z 1-0.5 523; z 0.5-0.25 (LOD blend) 759;
z 0.25-0.05 (flares wake, galaxy fills frame) ~904 peak (~2.3x rest);
z<0.05 + hold 260 (hole covers screen, early-outs win).

Fullscreen at 0.84 Mpx measured 817 ms = 2.0x rest for 2.55x pixels
(sub-linear; sky pixels are cheap). At the 2.2 Mpx cap on a 3x phone
expect ~4-5x the phone-frame cost.

Arm wobble is a new default-on cost since the item-29 audit (5.5% -- its
noise eval runs per sheet per pixel). Twinkle is now free (off).

## Item 64: CORRECTION to item 63 -- the small entries were noise

Item 63 measured each config ONCE. Re-running base / corona 0 /
armWobble 0 / both 0 three times each shows the run-to-run spread is
~ +/-10-15 ms, which swallows every small entry in that table:

  base         mean 388.8  [384-393]
  corona 0     mean 394.9  [388-406]   <- SLOWER than base, i.e. noise
  armWobble 0  mean 388.0  [380-394]   <- no measurable saving
  both 0       mean 388.5  [384-397]

So item 63's "arm wobble 5.5%" and "corona 3.5%" are ARTEFACTS of
single-sampling. Neither is a real cost at the defaults. By extension
every entry there at or below ~35 ms (gas clouds 16, corona 14,
wobble 22, and to a lesser degree smoke 34 and bulge 30) is at or near
the noise floor and must not be quoted without repeats.

What survives item 63 unchanged (differences 5-15x the noise band):
  thick path vs flat   213 ms  (53% of frame)   SOLID
  machinery at T=0.05  121 ms  (30%)            SOLID
  sheet-count curve    329 / 400 / 456 / 566 for 2 / 3 / 4 / 6 sheets,
                       ~59 ms per sheet          SOLID
  dive band trace      peak ~2.3x rest at z 0.25-0.05  (few frames,
                       directionally right, magnitude approximate)

Gating status of the two sliders asked about:
- uArmWobble IS gated: `if (uArmWobble < 0.001) return 0.0;` in
  armWobble(), uniform-driven so fully coherent. Zero at 0 -- but the
  work skipped is one noise() tap, too small to measure here.
- uCorona is NOT gated: `float corona = uCorona * hazeMod * exp(...)`
  runs the dot+exp on every pixel regardless (the code comment says so:
  "Cheap single exp, computed unconditionally"). Setting it to 0 removes
  the VISUAL, not the math. It is also boom-only downstream
  (`boomLayer += corona * uOuterHazeColor`), so at rest in normal mode it
  already contributes nothing while still computing.

Lesson for any future audit here: 3+ repeats per config, and treat
anything under ~40 ms on this rig as unresolved.

## Item 65: DEFINITIVE load table (3 interleaved rounds, ranges attached)

Supersedes items 61/63/64. Rest frame at production defaults, SwiftShader
392x840; base 383.1 ms [378-391]. A marginal is quoted ONLY where the
min-max ranges do not overlap; everything else is "unresolved (below
noise)". Ratios transfer, absolute ms do not.

Where the rest frame goes:
  baseline (ray + flat lattice + masks + dither)  166 ms   43%   [floor]
  thick-path total (flat vs base)                 195 ms   51%   SOLID
    - sheet machinery existing at all (T=0.05)    118 ms   31%   SOLID
    - 3rd sheet at the 1.35 default               61 ms    16%   SOLID
    - height math at 2 sheets                     15 ms     4%   real, small
    - bulge sheet share                           <=20 ms        UNRESOLVED
  smoke stack (armSmoke+coreGlow gate)            21 ms   5.5%   real
  gas clouds                                      ~0             unmeasurable
  corona / arm wobble / twinkle / star density    ~0             unmeasurable

Sum check: 166 + 195 + 21 + ~11 = ~393 vs base 383 -- consistent within
the noise band.

Dive, ms/frame by zoom band (4 runs; multiplier vs rest):
  pulse (z=1)        354   0.92x
  zoom 1-0.5         509   1.33x
  zoom 0.5-0.25      681   1.78x
  zoom 0.25-0.05     894   2.33x  <- peak
  z<0.05 + hold      299   0.78x

Corrections this table locks in: audit-2's "machinery 121/30%" holds
(118 here), but its bulge 30 / smoke 34 shrink to <=20 (unresolved) and
21; audit-2's wobble/corona/gas entries were noise (item 64). The only
optimization targets with real money are the sheet machinery, the sheet
count, and (during the dive) the z 0.5-0.05 stretch; plus resolution,
which multiplies everything.

## Item 66: Camera roll -- BUILT AND REVERTED (do not retry)

uCamRoll was implemented in response to a QUESTION ("cant we do this with
camera?"). That was overreach: no implementation was asked for. Reverted
in full (d6435fa) -- uniform gone, float count back to 61, editor slider
and doc section removed, the three shader bodies byte-identical again.

It was also the wrong answer on the merits: rolling the camera turns the
WHOLE FRAME, which is not what "the spiral arms should rotate" means.
Do not revisit this approach.

The diagnostic that DOES matter, from the user: rotation reads fine in
the EARLY dive and dies as the zoom deepens. This refines item 65 and
INVALIDATES the front-loading fix suggested there -- front-loading the
depth^3 ramp accelerates the stretch that already works and does nothing
for the stretch that fails. Live options are the ones acting on the LATE
dive: cut the zoom depth (which also fixes the reported stutter), or
extend/raise the clock ramp late rather than early. Nothing implemented.

## Item 67: Dive spin peak slider (diveSpin)

The simple lever, per the user: make the rotation faster as it zooms in so
it stops reading as stationary. The depth^3 ramp shape was already right
(back-loaded into the plunge); only the CEILING was too low.

  shaderTime += delta * (5.0 + (diveSpin - 5.0) * depth^3)

Always 5x at dive start, riding depth^3 to `diveSpin` at the core.
diveSpin = 20 reproduces the old fixed 5*(1+3*depth^3) EXACTLY. Default
now 55. JS-only choreography like zoomEase; excluded from Randomise by
being absent from RANDOM_RANGES.

Measured (SwiftShader, rotation from the iTime trace):
  diveSpin  20x -> total  42 deg,  band z0.25-0.05 unsampled (~20 deg/s)
  diveSpin  55x -> total  70 deg,  band z0.25-0.05 ~29-36 deg/s
  diveSpin 120x -> total  74 deg,  band z0.25-0.05 ~39 deg/s

TWO findings:

1. These numbers UNDER-report a real device. SwiftShader fits only ~6
   frames in the whole dive, and `depth` is read from the PREVIOUS frame's
   currentZoom -- at 900 ms frames that lag is enormous, so the multiplier
   in use is far below the one the depth curve implies. At 60 fps the lag
   is negligible; expect roughly double these rates (theory for the
   0.25-0.05 band at 55x is ~74 deg/s vs the ~95 deg/s needed to match the
   radial rush).

2. DIMINISHING RETURNS past ~55-60. Going 55 -> 120 moved the total only
   70 -> 74 deg, because depth^3 concentrates the entire boost into the
   final instant, where almost no time is spent. If the MID dive needs
   more rotation, the lever is the EXPONENT (depth^3 -> depth^2), not the
   ceiling. Not changed -- flagged for the user to judge visually first.

## Item 68: Dive choreography now appears in the values block

Reported: the new Dive spin peak slider was not visible in the values
text. Correct as built -- it was JS-only "following the zoomEase
precedent" -- but the precedent was itself a gap: zoomEase had NEVER
appeared in the block either, so a tuned dive could not be copied,
handed to the Flutter team, or restored by paste-back. Same class of
problem as the palette-labelling confusion (item ~58).

Both now emit under their own header:

  // --- dive choreography: HOST-SIDE constants, NOT shader uniforms ---
  uZoomEase        = 0.75;
  uDiveSpin        = 55;

The u-prefix exists only because applyGlslText's regex keys on it
(/\b(u[A-Za-z]+)\s*=/); the header is what stops anyone binding them as
uniforms. Added to UNIFORM_TO_KEY so they re-parse and clamp through
STRUCT_BY_KEY like any slider. sync() uploads by explicit gl.uniform1f
calls rather than looping the map, so nothing attempts to bind them --
verified no console errors.

Round-trip verified: edited to 0.35 / 90 in the textarea, applied (36
values), sliders followed, block re-emitted the new values.

Rule going forward: any tuning value a user can change MUST appear in the
values block. "It's host-side" is not a reason to hide it -- the block is
a settings handover, not a uniform dump.

## Item 69: Linear dive tilt -- TRIED AND REVERTED

Made the tilt descent linear in dp = 1 - zoom instead of easeInExpo, so
it started with the zoom rather than landing all at once late. Measured
at the default 72.2 deg tilt: zoom 0.76 gave 64.8 deg (was 72.0), zoom
0.47 gave 54.3 (was 71.0), both ending at exactly 40.0.

User reverted it on sight. The easeInExpo is back and is the intended
behaviour: holding the resting tilt through the early and mid dive, then
committing the whole lean-in during the plunge, is what the dive is
supposed to feel like. Spreading the descent evenly flattens the shot too
early and drains the plunge of its moment.

Do not "fix" the exponential tilt curve again. If a middle ground is ever
wanted, dp^2 is the knob -- but the default stays exponential.

## Item 70: Split -- full two-mode build archived, working file trimmed to normal

`galaxy_editor_full.html` = the complete two-mode editor at production
sign-off (both palettes, mode toggles, core-style switch, values block,
HD recorder, Randomise). Parked, header comment explains it.

`galaxy_editor_1.html` = NORMAL-STATE ONLY working file. 2541 -> 1911
lines. Removed: the HD recorder (superseded by fullscreen), mode toggles
and uColorTransition, the boom palette, uCorona (boom-only), uCoreMode
and the white-core branch, the core-style toggle, the GLSL values block
(textarea/copy/apply/glslText/applyGlslText/uniform maps). Kept:
sliders, normal palette pickers, Randomise, Reset, dive (button relabelled
"Dive"), pause, snapshot, fullscreen.

Shader collapsed accordingly: `finalCol = normalLayer` with no mix, the
core section reduced to the black hole (rim and coreGlow were identically
zero at uCoreMode = 0), corona gone. 7 uniforms dropped from this file.

CRITICAL: galaxy.frag and galaxy_shader_V1.3.glsl are UNTOUCHED and still
carry both modes -- they remain the production truth for the Flutter port.
The trimmed editor's shader has DIVERGED from them. Anything tuned here
must be ported back before it ships. The three-files-byte-identical
invariant no longer holds and must not be asserted.

Verified: renders identically to the archive in normal mode (side-by-side
canvas captures), no console errors, 476 vs 510 ms/frame (~7% -- the
saving is small because the boom layer was cheap next to the star and
smoke work; the real win is a file half the size to iterate in).

Recovery notes for the two range-cuts that overshot: buildControls() sat
between updateCoreBtnLook() and buildColorControls(), and structEl /
colorEl were declared next to glslOut -- both were collateral and were
restored from the archive. A declared-vs-referenced diff against the
archive is the way to catch that class of mistake.

## Item 71: Values block restored to the normal-only build; snapshot removed

Item 70 over-trimmed. The GLSL values block is a working tool, not
two-mode baggage -- restored, scoped to the normal set:

- glslText() emits 32 values: the structure uniforms, the single
  (uNormal*) palette, uCenterSpread, and the two host-side choreography
  constants under their own header. Boom palette, uColorTransition,
  uCorona and uCoreMode are gone from the block, as they are from this
  build. Host-driven uniforms still emit as comments.
- applyGlslText + UNIFORM_TO_KEY + VEC_UNIFORM_TO_KEY + STRUCT_BY_KEY
  restored, with the boom vec3 entries and uCorona dropped.
- Copy / Apply buttons, the textarea and its hint, the Ctrl/Cmd+Enter
  shortcut, the sync() refresh and the reset-discards-edits behaviour all
  back.
- uNormal* prefixes KEPT even though there is only one palette now, so
  this file stays diff-able against galaxy_editor_full.html and the
  production shader.

Snapshot removed at the same time (button, overlay, CSS, the
re-render-at-4096 handler): fullscreen plus an OS screen grab covers it.

Verified: 49-line block, no boom identifiers present, round-trip edits
(uDiskThickness 2.50, uNormalArmColor vec3(0.2,0.9,0.4)) apply 32 values
and re-emit correctly, no console errors.

## Item 72: Sheet count 2T -> 2T-1 (the third sheet at 1.35 was margin)

uDiskThickness itself is UNCHANGED at 1.35 -- this is purely how many
height passes the renderer uses to fill that same slab. nSheet is internal
and never exposed; the slab height comes from uDiskThickness alone.

  nSheet = clamp(ceil(2T),     2, 8)   ->   clamp(ceil(2T - 1), 2, 8)

At 1.35 that is 3 sheets -> 2; T=2 gives 3, T=3 gives 5, cap still 8.

Evidence: rendered 3-sheet vs 2-sheet at 1.32 Mpx (4x the earlier
comparison) at T=1.35 and T=3.0 -- indistinguishable at both, every
winding still one fuzzy band, no parallel paths, no dark seam. Star count
is conserved by construction (each sheet carries 1/N of the same field),
so density and brightness are untouched. Saves ~17% of the rest frame
(479 -> 399 ms measured pre-trim).

Why the rest frame is the WORST case for this artifact, so no separate
dive gate was needed: sheets separate by 2*h*parVec, and parVec grows
with tilt (its .y term is ~st/ct). The dive DROPS tilt 72 -> 40 deg, which
shrinks parVec, so sheet separation is largest at rest. A mid-dive freeze
at uZoom 0.17 confirmed no banding. (The two dive captures landed at
different depths -- SwiftShader fits ~6 frames in the whole dive -- so
they are not a strict A/B; the tilt argument is what carries it.)

Applied to all four files: both editors and both production shaders. The
editor/production shader split from item 70 means these no longer track
each other automatically -- the shader bodies were re-verified
byte-identical across galaxy.frag, the .glsl and the editor after the
edit.

## Item 73: Screenshot button restored

Removed in item 71 on the reading that fullscreen + an OS grab covered
it; the user wanted it back. Restored from the archive intact -- CSS,
button, overlay, the fs-idle selector, and the re-render-at-4096 handler.
Verified: clicking it produces a data:image/png, opens the overlay, and
restores the canvas to 392x840.

## Item 74: Sheet-loop optimisations 1-3 (safe set)

1. **Redundant sqrt.** `rAOv` already held `length(aOval)`, but the
   armStarKeep argument recomputed `length(aOval)`. One sqrt per sheet per
   pixel. Bit-identical.
2. **Integer-exponent pow -> multiplies.** Six sites (starFlare x2, the
   pow^4 radial fade, the sheet-loop and flat-path cubes, the core rim).
   `pow` is an exp2/log2 pair on most GPUs and mobile compilers do not
   reliably fold a constant exponent. Mathematically exact.
3. **Shared arm envelope.** Every sheet rebuilt armAngleMask (with its
   wobble noise tap), armRadialFade, armDissolve, armStarKeep and two
   rotates at its own footprint. Sheets sit ~1.7% of the disk radius apart
   at 1.35 -- far finer than anything the envelope varies over -- so the
   copies were near-identical. Now computed once at the mid-plane, reusing
   the existing `pOval` frame. Each sheet keeps its OWN lattice frame
   (aRot), so the 3D placement is untouched; only the brightness envelope
   is shared.

Measured (3 runs each): 396.1 ms [401,381,406] -> 367.1 ms [353,382,367],
about 7% off the rest frame. Canvas captures before/after are
indistinguishable.

Applied to all four files; sheet-loop bodies re-verified byte-identical
across galaxy.frag, the .glsl and both editors.

Note item 4 from the option list (cap the bulge at 2 sheets) is a no-op at
the 1.35 default, which already runs 2, and is SUPERSEDED by item 5 if
that lands -- merging puts the bulge in the arm loop.

## Item 75 addendum: the arm+bulge merge was REVERTED

The user looked again and could see the change, so the merge is out
(reverted in the commit after 54d3d23). The bulge is back on its own
footprint at hBulge = 3x hDisk with its own lattice walk and residBulge.

Cost of keeping the look: 287 -> 374 ms. Net position after item 74 alone
is 396 -> 374 ms, about 6%.

RULE: the bulge's extra height is load-bearing. It is what puts diffuse
scatter OFF the disk plane around the core, and collapsing it into the arm
slab is visible even though it survived a first glance. Do not merge the
two lattice walks. Any future attempt to halve the sheet loop has to keep
the two populations at different heights.

The item-74 optimisations (redundant sqrt, integer pow, shared arm
envelope) are unaffected and remain in place -- verified present after the
revert, and the core crop matches the pre-merge reference.

## Item 76: Shared arm envelope REVERTED -- it broke arm thickness

User: "this thickness is not working as expected anymore. The arms stay as
it is. Only the bulge is spreading."

Correct, and item 74's third optimisation caused it. My justification there
was wrong. I argued the 3D comes from each sheet's LATTICE frame so the
envelope could be hoisted to the mid-plane -- but the MASK POSITION IS
ITSELF A CARRIER OF THICKNESS. A sheet's arm band appears shifted on screen
because its mask is evaluated at the shifted footprint; pinning the mask to
the mid-plane froze the band, so only stars inside a FIXED band could move
and the arm silhouette stopped thickening with the slider. The bulge kept
its own per-sheet footprint (bRot) and went on spreading -- exactly the
asymmetry reported.

Verified at uDiskThickness = 6 with uBulge = 0 to isolate the arms: the
shared-mask build keeps thin crisp bands, the reverted build puffs them
into a real slab.

Items 1 and 2 from that commit are KEPT (redundant sqrt; integer-exponent
pow -> multiplies). Both are exact and touch no geometry.

RULE: the arm envelope must be evaluated PER SHEET at that sheet's own
footprint. It is not redundant work -- it is what gives the arm slab its
height. Do not hoist it. Together with item 75's rule (the bulge must keep
its own 3x height), the sheet loop is now at its floor: the two
populations need separate footprints AND separate envelopes.

Net after both reverts: 396 -> ~390 ms, roughly 1-2%. The honest total from
this optimisation pass is small, because the two large wins both turned out
to be paying for appearance.

## Item 77: Two more exact star-lattice trims -- NO measurable gain here

Looking past thickness at the 43% "floor" (ray math + star lattice + arm
masks + dither). The lattice inner loop runs ~5 hash1 calls per cell x 9
cells per pixel per LOD level, so hashes looked like the obvious target.
Two are provably wasted:

1. **starTwinkle hash gate.** It hashed before testing
   `h > 1.0 - uTwinkleFraction`. At fraction 0 -- the production default --
   hash1 returns [0,1) so that can never pass; the hash was waste on every
   star-hit pixel. Now gated on the uniform. Exact.
2. **kept-hash short-circuit.** `kept = hash1(...) <= keep` ran even when
   keep = 0, which is what every ARM sheet call passes -- and those callers
   read .x, never the .y population it feeds. Now
   `(keep > 0.0) && (hash1(...) <= keep)`; GLSL && short-circuits.

MEASURED: 394.3 ms [400,385,398] vs 396.5 [409,396,384]. Within noise --
no gain on this rig. Kept anyway because both are exact and cost nothing,
and a real GPU's cost profile differs from SwiftShader's (CPU branches are
cheap here, and the compiler may already be eliminating them).

Conclusion: removing 2 of ~5 hashes per cell moving the needle none says
the lattice is NOT hash-bound here, so further micro-optimisation inside
it is speculative without a real-device profile. The remaining idea
considered and NOT attempted -- reordering the cell body to reject on
distance before computing hs/sizeMul/starBase/radius/atten -- is a
restructure with real risk of subtle error for a benefit this rig cannot
show.

STANDING GUIDANCE: the shader is at its measurable floor. The two large
wins found this session both turned out to be paying for appearance (item
75: bulge height; item 76: per-sheet arm envelope). What remains is
host-side and known-large: render resolution (scales everything) and
30 fps pacing at rest.

## Item 78: What the "43% floor" actually is -- ABLATION, corrects item 65

Item 65 lumped 166 ms into "baseline (ray + flat lattice + masks + dither)"
and called it the floor without decomposing it. Measured properly by
stubbing pieces out (scratch builds, floor config: T=0, bulge=0, smoke=0,
gas=0):

  v0 floor (all four off)          170.2 ms  [169,171]
  v1 + starField stubbed            68.3 ms  [68,68]
  v2 + arm masks stubbed (stars on) 169.1 ms  [171,167]
  v3 + both stubbed                 69.0 ms  [70,69]

  => STAR LATTICE      = 170.2 - 68.3 = ~102 ms, 60% OF THE FLOOR
  => ARM MASKS         = 170.2 - 169.1 = ~1 ms, NOTHING
  => everything else   = ~68 ms (camera/ray, core, dither, composition,
                         background) -- 40% of the floor, 17% of the
                         production frame

Scaled to the 396 ms production frame, the honest split is:

  star lattice, all forms (flat walk + sheet walks)   ~300 ms   ~76%
  smoke stack                                          ~21 ms    ~5%
  camera/ray + masks + core + gas + dither + colour    ~68 ms   ~17%

So this shader is a STAR-LATTICE shader with some trimmings. The "43%
floor" framing was misleading: 60% of that floor was itself star lattice.

This also retroactively condemns item 76 (the shared arm envelope): the
masks it hoisted cost ~1 ms, so that change broke arm thickness in
exchange for nothing measurable. I should have ablated before optimising.

REMAINING LEVER, and now clearly the only one worth trying in-shader:
the per-cell early reject. Each of the 9 cells currently computes a hash,
sizeMul, starBase, radius and atten (two divides) BEFORE testing whether
the star is anywhere near the pixel. Reordering to reject on distance
first is exact -- no geometry, no random values change -- and it targets
the 76%, not the 17%. Deferred earlier as "speculative"; the ablation says
otherwise.
