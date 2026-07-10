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
2. **Dive duration 5.5 s** + 700 ms hold + 1.5 s fade-in of new state (hold/fade are
   for testing the state switch, intentionally kept).
3. **Pause/Resume button** during dive (shifts zoom clock by paused duration).
4. **Instant Normal/Boom buttons** — abort any in-progress dive and snap to end state.
5. **Star size variance** — per-star `sizeMul = mix(0.5, 1.8, hs²)` (skewed small).
6. **LOD refill cap** — `uMaxStarLod` (default 2.0): past that many grid doublings the
   field stops refining, so diving reads as flying PAST stars.
7. **Stellar bulge + disk population** — `uBulge` (default 0.70). Exponential-disk
   falloff `exp(-r · 1.85)` drives per-star PRESENCE (hash-gated count, not dimming);
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
12. **Disk thickness (3D stars)** — `uDiskThickness` (default 0.50; **0 = old flat
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
    use pxCtl.x now. Per-star gate (user: lag + too many): only hs > 0.9
    (top ~10 % by size) of the main field flares, hs > 0.5 of floaters —
    non-flaring stars keep the plain disc and its exact old cost.
    Whole flare tapers to exactly zero at the reach boundary
    (`1 − smoothstep(0.65·reach, reach, dist)`) — without it the bloom
    truncated mid-glow and every flared star sat inside a visible
    clipped disc.
    Perf note: profiling showed the EARLY dive frames are the heaviest
    (full haze × 2 smokeMaps + LOD cross-fade doubling all 8 sheet passes)
    — the dive was already heavy before flares. Biggest untapped mobile
    lever: drop canvas DPR during the dive (motion hides it).
17. **Haze extinction in the deep dive** — `hazeVis = smoothstep(0.04, 0.30,
    uZoom)` multiplying smoke/b/corona. Non-linear per user: haze untouched
    until ~⅓ zoom, then dies fast as the hole fills the view; ends black
    behind the star swarm like the reference. The gates also skip both
    smokeMap calls late-dive, so the deepest frames get FASTER.
18. **Dive ease-in** — smoothstep on dive progress (first ~1.5 s barely
    moves, like the reference; 1/zoom growth still dominates the tail).
19. **Star density slider 0–4** (was 0–2; default unchanged 2.0). Largest
    stars now cap at 0.9 cell so density > ~2.9 can't clip at lattice
    borders (no-op at the old range).

## Current defaults (also the Reset state)

```
uArmCount 2 · uArmWinding 16.0 · uArmSpacing 1.12 · uHaze 0.80 · uBulge 0.70
uDiskThickness 0.50 · uFlare 0.60 · uOvalness 1.00 · uCamTilt 1.27 · uRotSpeed 0.050 · uCompactness 1.50
uStarDensity 2.00 · uMaxStarLod 2.0 · uTwinkleFraction 0.99 · uTwinkleSpeed 3.00
uCoreMode 0 · uBlackHoleSize 0.064 · uCenterSpread 0.50
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
- **Final Flutter sync** of all changes when iteration is done.

## Dev environment notes

- Preview server: `python3` via custom script in the session scratchpad
  (`serve.py`, reads PORT env var, serves the project dir, `/` →
  `galaxy_editor_1.html`). Plain `python -m http.server` fails: macOS sandbox denies
  `getcwd()`/Documents access to the preview-spawned process.
- Testing dives: browser-tool latency exceeds the 7.7 s cycle — schedule clicks
  inside the page (`preview_eval` + `setTimeout` on `#boom-btn` / `#pause-btn`) and
  screenshot while paused.
