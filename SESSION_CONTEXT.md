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

## Current defaults (also the Reset state)

```
uArmCount 2 · uArmWinding 16.0 · uArmSpacing 1.12 · uHaze 0.80 · uBulge 0.70
uOvalness 1.00 · uCamTilt 1.27 · uRotSpeed 0.050 · uCompactness 1.50
uStarDensity 2.00 · uMaxStarLod 2.0 · uTwinkleFraction 0.99 · uTwinkleSpeed 3.00
uCoreMode 0 · uBlackHoleSize 0.064 · uCenterSpread 0.50
boom:   center (0.294,0.376,0.569) · arm (0,0.482,1) · haze (0.259,0.345,1) · star (1,1,1)
normal: center (0.886,0.878,1) · arm (0.639,0.651,1) · haze (1,1,1) · star (1,1,1)
```

## Pending / agreed next steps (not yet implemented)

- **Zoom floor ~0.08–0.12** for the dive (match reference's ~10–15× depth; hole then
  naturally caps at ~30 % width). Ending choreography (hold/fade) stays as-is.
- **Star diffraction flares + bloom** on large/bright stars late in the dive — the one
  genuinely new shader feature still missing vs. the reference.
- **Late-dive star size tuning** (reference stars reach ~2 % screen width).
- **Haze thinning during deep zoom** (avoid flat gray wash mid-dive).
- **Ease-in curve** on dive start (smoothstep; less critical once zoom is floored).
- From the 3D brainstorm: star height/parallax scatter (cheap), optional two-layer
  smoke depth (moderate). Full volumetric raymarch ruled out (mobile load).
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
