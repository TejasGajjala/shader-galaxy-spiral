# Flutter implementation guide — `galaxy_floater.frag`

A production-lean variant of `galaxy.frag`, built and measured on a real
device. Same spiral, same dive, but the most expensive feature of the
original is gone and replaced with a much cheaper way of showing depth.

`galaxy.frag` and its guide are unchanged — this is a parallel build, not
a replacement. Use whichever suits.

---

## 1. What is different from `galaxy.frag`

**Removed: the volumetric height-sheet disk.**

The original builds thickness by drawing the star field several times over
at different heights ("sheets"), driven by `uDiskThickness`. On the test
device that machinery measured **~72% of the whole frame** — by far the
single biggest cost in the shader.

It is gone in this build, and with it:

- the `uDiskThickness` uniform,
- the N-sheet loop and its `ceil(2T-1)` sheet count,
- the per-star sheet partition (`partLo` / `partHi`),
- the per-star residual height shift inside the star lattice.

**Added: an off-plane floater layer on the flat disk.**

Depth now comes from one coarse, sparse sheet of stars sitting *above* the
disk plane, projected with the same real parallax the original used
(`ps = p - parVec * h`). These are genuinely 3D-placed stars, not a painted
effect — as the galaxy turns, they shift correctly against the disk.

Four new uniforms drive it: `uFlatFloaters`, `uFloaterDensity`,
`uFloaterSize`, `uFloaterSpread` (indices 45–48).

**Net effect:** you lose the filled volumetric loft — the sense that the
arm bands themselves have vertical thickness. You keep the depth cue of
stars visibly off the disk silhouette. The compiled shader is roughly half
the size, and it holds 60fps where the original could not.

**Other changes**

| Change | Why |
|---|---|
| Floater presence follows the bulge's gaussian `exp(-r²·7/sp²)` | The original `exp(-r·1.1)` scattered floaters far outside the spiral |
| Floater grid density is a uniform (was hardcoded `5.0`) | More floaters at ~no extra cost — the lookup always walks the same 9 cells |
| Floater size rides the star LOD ladder (`/sqrt(lvlF)`) | Fixed size made them balloon into white discs mid-dive |
| Floater screen cap `15px → 8px`, size variety `mix(0.7,1.4) → mix(0.45,1.9)` | Smaller, more varied floaters |
| Floaters never flare | Diffraction spikes were tried here and were not visibly distinguishable from the main field's own flares |

---

## 2. Setup

```yaml
flutter:
  shaders:
    - shaders/galaxy_floater.frag
```

```dart
final program = await ui.FragmentProgram.fromAsset('shaders/galaxy_floater.frag');
final shader  = program.fragmentShader();
```

---

## 3. Uniform index table

Flutter sets uniforms **by float index in declaration order** (`vec2` = 2
slots, `vec3` = 3). Total: **49 floats**.

| idx | uniform | default (rest) | notes |
|----:|---------|----------------|-------|
| 0–1 | `iResolution` | canvas size | must match the space `FlutterFragCoord()` reports in — see §4 |
| 2 | `iTime` | clock | rotation clock, **not** wall time |
| 3 | `uZoom` | 1.0 | 1 = rest … →0 = dived |
| 4 | `uFade` | 1.0 | 0 = black; host-only |
| 5 | `uRotSpeed` | 0.036 | spin speed |
| 6 | `uArmCount` | 2 | |
| 7 | `uArmWinding` | 19.5 | |
| 8 | `uArmSpacing` | 1.03 | where the turns sit |
| 9 | `uArmFalloff` | 0.70 | arm stars: outward density thinning |
| 10 | `uArmSpread` | 1.00 | arm stars: outward band widening |
| 11 | `uArmEdgeSkew` | 0.75 | hard inner edge / feathered outer edge |
| 12 | `uRimCoarse` | 0.22 | outermost star band thinning |
| 13 | `uArmWobble` | 0.19 | static noise warp on the arm phase |
| 14 | `uArmSmoke` | 0.80 | smoky filaments tracing the arms |
| 15 | `uSmokeSkew` | 0.46 | edge skew for the smoke arms |
| 16 | `uCoreGlow` | 1.00 | broad glow at the nucleus |
| 17 | `uCoreGlowSpread` | 0.75 | core glow radial reach |
| 18 | `uBulge` | 1.50 | stellar bulge strength |
| 19 | `uFlare` | 1.00 | diffraction spikes; alive only late in the dive |
| 20 | `uHazePulse` | 1.0 | dive-start beat, 1 = neutral |
| 21 | `uGasClouds` | 0.3375 | drifting gas-cloud layer |
| 22 | `uOvalness` | 1.09 | |
| 23 | `uCamTilt` | 1.26 | radians off top-down; the dive drives this |
| 24 | `uCompactness` | 1.88 | |
| 25 | `uStarDensity` | 3.00 | |
| 26 | `uMaxStarLod` | 2.0 | caps star-grid refill during the dive |
| 27 | `uTwinkleFraction` | 0.00 | |
| 28 | `uTwinkleSpeed` | 0.00 | |
| 29 | `uTwinkleTime` | wall clock | never the scaled `iTime` |
| 30 | `uPxSize` | — | recompute on resize/zoom/tilt — see §5 |
| 31 | `uBlackHoleSize` | 0.049 | |
| 32–34 | `uNormalCenterColor` | 0.886, 0.878, 1.000 | |
| 35–37 | `uNormalArmColor` | 0.639, 0.651, 1.000 | |
| 38–40 | `uNormalHazeColor` | 1.000, 1.000, 1.000 | |
| 41–43 | `uNormalStarColor` | 1.000, 1.000, 1.000 | |
| 44 | `uCenterSpread` | 0.33 | how far the centre tint reaches |
| **45** | **`uFlatFloaters`** | **2.0** | off-plane floater height. **0 = off entirely** |
| **46** | **`uFloaterDensity`** | **30.0** | floater lattice density (upstream hardcoded 5) |
| **47** | **`uFloaterSize`** | **1.0** | overall floater star size |
| **48** | **`uFloaterSpread`** | **1.5** | floater reach as a radius multiple of the bulge (1.0 = exactly the bulge) |

Note `uFlatFloaters` doubles as the on/off switch: at 0 the other three do
nothing.

---

## 4. `iResolution` is LOGICAL pixels in Flutter

The original guide says physical pixels. **In Flutter that is wrong and it
will put the galaxy off-screen.** `FlutterFragCoord()` reports in the
canvas's *logical* coordinate space, so `iResolution` must be
`size.width, size.height` — no `devicePixelRatio`.

`uPxSize` is the exception: it describes the size of one *rendered* pixel,
and rasterisation still happens at physical density, so that one does scale
by dpr (see §5).

---

## 5. Driving it

Clocks, dive choreography and camera tilt are **unchanged** from
`galaxy.frag` — follow §4–§7 of the original guide. In short:

- `uTwinkleTime` is plain wall-clock seconds, always.
- `iTime` is a *rotation* clock: accumulate `shaderTime += dt * rate`, where
  rate is 1 at rest and ramps during the dive. Feeding it seconds-since-mount
  looks right at rest and then reads as frozen mid-dive.
- Dive = pulse 1000ms → zoom 4000ms (ease-in-out) → hold 1000ms → snap home.

`uPxSize`, computed against the **rendered** pixel grid:

```dart
double pxSize(double w, double h) =>   // w,h in PHYSICAL/rendered pixels
    3.3 * zoom * math.max(1.0 / w, 1.0 / (h * math.cos(currentTilt())));
```

---

## 6. Render scale (the biggest lever)

This shader is fill-rate bound: cost tracks the number of pixels shaded, not
much else. Flutter has no implicit render-scale — a `Transform` still
rasterises the layer at device resolution — so you have to render into a
smaller image yourself:

```dart
final recorder = ui.PictureRecorder();
Canvas(recorder).drawRect(Rect.fromLTWH(0, 0, rw, rh), Paint()..shader = shader);
final picture = recorder.endRecording();
final image = picture.toImageSync(rw.toInt(), rh.toInt());
canvas.drawImageRect(image, Rect.fromLTWH(0, 0, rw, rh), Offset.zero & size,
    Paint()..filterQuality = FilterQuality.medium);
image.dispose();
picture.dispose();   // both are GPU-resident; leaking them exhausts VRAM in seconds
```

Two things that matter:

- **`iResolution` must be the render size**, and `uPxSize` must use that same
  grid, or the stars alias badly.
- **Dispose the image and picture every frame.**

**Suggested: adapt the scale to state.** Render sharper at rest, softer while
diving — motion hides the softness. On the test device, one step up at rest
and one step down during the dive worked well (e.g. 648×1440 at rest,
432×960 while `diving` is true). The original guide suggests the same idea.

---

## 7. Performance — measured, and what is still open

**Test device:** OnePlus 9 (LE2111), Android 14 / SDK 34, Snapdragon 888
(SM8350), **Adreno 660**, OpenGL ES 3.2 (driver 2023-11-09). Display
1080×2400 @ density 480 (dpr 3.0), 120Hz-capable but running 60Hz.
**Release** build, **Impeller disabled** (Skia on GL).

Frame budget at 60Hz is 16.7ms. All figures are GPU raster time.

| | Raster |
|---|---:|
| `galaxy.frag`, thick disk, native 1080×2400 | ~91 ms |
| Same, flat disk, native | ~27 ms |
| This build, native 1080×2400 | ~20 ms |
| This build, 540×1200 | ~4.5 ms (floaters off) |

Removing the height-sheet disk and rendering at 540×1200 is what turns a
13fps galaxy into a 60fps one.

### Two honest caveats

**Thermal state changes everything.** Every good number above is from a cool
device. The same configuration heat-soaked measured roughly **3× slower**
(e.g. a 4ms frame becoming ~17ms). Budget against the hot number, not the
cool one.

**The floater layer's cost is unresolved.** In one measurement session the
floaters cost essentially nothing; in a later one, at identical settings,
they measured ~11ms at 540×1200. The floater code is byte-identical between
those builds and the uniform binding was verified correct in both, so one of
the two measurements is wrong and it has not yet been settled. **Treat the
floater cost as unknown and measure it on your own target device** before
relying on it. Everything else in this table reproduced consistently.

### Cheap wins that are already in

- The star field skips its second LOD level at rest (`uZoom == 1`), halving
  the star pass — a uniform-coherent branch, no visual change.
- A far-field early-out drops the whole galaxy stack for sky pixels.
- Floater presence uses a gaussian that rejects most cells cheaply before any
  per-star maths.

---

## 8. Licence

Arm/dust/disk maths adapted from S. Guillitte's galaxy shader
(CC BY-NC-SA 3.0), as in the original `galaxy.frag`.
