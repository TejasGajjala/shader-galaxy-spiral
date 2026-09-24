# Flutter implementation guide — `galaxy_production.frag`

The build that shipped. `galaxy_floater.frag` with a **background cosmos**
(stars, drifting gas), a **reworked dive** (flares, pacing, tilt, spin) and a
set of framing changes, all tuned on a real device.

`galaxy.frag` and `galaxy_floater.frag` and their guides are unchanged — this
is a parallel build. `galaxy_production_main.dart` is the full Flutter driver
that produced every number below; it is reference, not a library.

---

## 1. What is new since `galaxy_floater.frag`

**The galaxy is no longer alone in a black void.** Three layers were added
behind it, all off by default at uniform 0:

- **Background starfield** (`uBgCount`, `uBgSize`, `uBgDrift`) — a single-cell
  lattice, one star per occupied cell. No 3×3 neighbour scan: the cheap
  lookup is the whole trick, and it is why this layer is free.
- **Nebula gas** (`uNebula`, `uGasSpread`, `uGasHue`) — two octaves of value
  noise. 12 hash taps per pixel, the only genuinely full-screen addition.
- **Both fade out during the dive** and are occluded by the galaxy, so the
  finale is the star swarm alone.

**The dive was reworked end to end**: flare profile, pacing, camera tilt,
rotation ramp. See §6.

**Framing**: the galaxy sits 64 logical px above screen centre (`uLiftY`) and
is intrinsically round (`uOvalness` 1.09 → 1.00), so the ellipse you see is
purely camera foreshortening and opens up as the dive leans.

---

## 2. Setup

```yaml
flutter:
  shaders:
    - shaders/galaxy_production.frag
```

```dart
final program = await ui.FragmentProgram.fromAsset(
  'shaders/galaxy_production.frag',
);
final shader = program.fragmentShader();
```

---

## 3. Uniform index table

Flutter sets uniforms **by float index in declaration order** (`vec2` = 2
slots, `vec3` = 3). Total: **62 floats**. Indices 0–48 are unchanged from
`galaxy_floater.frag`; 49–61 are new.

| idx | uniform | default (rest) | notes |
|----:|---------|----------------|-------|
| 0–1 | `iResolution` | render-target size | see §4 — **not** always logical pixels |
| 2 | `iTime` | clock | rotation clock, **not** wall time |
| 3 | `uZoom` | 1.0 | 1 = rest … →0 = dived |
| 4 | `uFade` | 1.0 | 0 = black; host-only |
| 5 | `uRotSpeed` | 0.030 | rad/s, ~209 s per turn |
| 6 | `uArmCount` | 2 | |
| 7 | `uArmWinding` | 19.5 | |
| 8 | `uArmSpacing` | 1.03 | |
| 9 | `uArmFalloff` | 0.70 | |
| 10 | `uArmSpread` | 1.00 | |
| 11 | `uArmEdgeSkew` | 0.75 | |
| 12 | `uRimCoarse` | 0.22 | |
| 13 | `uArmWobble` | 0.19 | |
| 14 | `uArmSmoke` | 0.80 | |
| 15 | `uSmokeSkew` | 0.46 | |
| 16 | `uCoreGlow` | 1.00 | |
| 17 | `uCoreGlowSpread` | 0.75 | |
| 18 | `uBulge` | 1.50 | |
| 19 | `uFlare` | 1.00 | diffraction spikes; alive only late in the dive |
| 20 | `uHazePulse` | 1.0 | dive-start beat, 1 = neutral |
| 21 | `uGasClouds` | 0.3375 | the galaxy's own cloud layer (not the backdrop) |
| 22 | `uOvalness` | **1.00** | round; was 1.09 |
| 23 | `uCamTilt` | 1.26 | radians off top-down; the dive drives this |
| 24 | `uCompactness` | 1.88 | |
| 25 | `uStarDensity` | 3.00 | |
| 26 | `uMaxStarLod` | **0.25** | in LOD DOUBLINGS, not zoom — see §7 |
| 27 | `uTwinkleFraction` | 0.00 | |
| 28 | `uTwinkleSpeed` | 0.00 | |
| 29 | `uTwinkleTime` | wall clock | never the scaled `iTime` |
| 30 | `uPxSize` | — | recompute on resize/zoom/tilt |
| 31 | `uBlackHoleSize` | **0.040** | |
| 32–34 | `uNormalCenterColor` | 0.886, 0.878, 1.000 | |
| 35–37 | `uNormalArmColor` | 0.639, 0.651, 1.000 | |
| 38–40 | `uNormalHazeColor` | 1.000, 1.000, 1.000 | |
| 41–43 | `uNormalStarColor` | 1.000, 1.000, 1.000 | |
| 44 | `uCenterSpread` | 0.33 | |
| 45 | `uFlatFloaters` | **1.7** | off-plane floater height. 0 = off entirely |
| 46 | `uFloaterDensity` | 30.0 | |
| 47 | `uFloaterSize` | 1.0 | |
| 48 | `uFloaterSpread` | 1.5 | |
| **49** | **`uFlareStart`** | **0.25** | zoom depth at which flares wake |
| **50** | **`uBgCount`** | **0.24** | background star occupancy. **0 = none, fully skipped** |
| **51** | **`uBgSize`** | **0.15** | background star radius CAP in px; roll spans floor→cap |
| **52** | **`uNebula`** | **0.60** | background gas brightness. **0 = off, fully skipped** |
| **53** | **`uBgDrift`** | **1.00** | per-star drift speed |
| **54** | **`uGasSpread`** | **0.20** | how much of the sky the gas covers |
| **55** | **`uGasHue`** | **0.50** | teal/rose accent strength; 0 = plain blue-violet |
| **56** | **`uCloudSpin`** | **0.4833** | galaxy cloud texture vs arms; 0.5 = locked |
| **57–58** | **`uGasRotA`** | cos/sin | gas octave A rotation — **host computes**, see §5 |
| **59–60** | **`uGasRotB`** | cos/sin | gas octave B rotation — host computes |
| **61** | **`uLiftY`** | see §5 | galaxy lift in p units |

Any of `uBgCount`, `uNebula`, `uBgDrift` at 0 removes that feature and its
cost. The backdrop is opt-in.

---

## 4. `iResolution` — read this before porting

The `galaxy_floater.frag` guide states this is always logical pixels. **That
is only true on one path**, and the correction matters:

`FlutterFragCoord()` is `#if`-switched by the engine. On **Impeller** it
returns a vertex varying; on **Skia** it returns `gl_FragCoord.xy`, which is
in *render-target* pixels.

So `iResolution` must match whatever space the shader is actually being
rasterised into:

- Drawing **straight into the frame** → `size.width, size.height` (logical).
- Drawing into an **offscreen image** via `PictureRecorder` +
  `toImageSync(w, h)` — which is what render scaling does — → `w, h`, the
  image's own pixel size.

Get this wrong and the galaxy is off-centre or off-screen entirely.
`uPxSize` follows the same grid as whichever you chose, or the stars alias.

---

## 5. Uniforms the host must compute

Three values cannot be derived inside the shader.

**`uGasRotA` / `uGasRotB` (57–60)** — cos and sin of the two gas rotation
angles:

```dart
const gasRateA = 0.055, gasRateB = -0.092;   // rad/s, opposite senses
final angA = twinkleTime * gasRateA;
final angB = twinkleTime * gasRateB;
f(math.cos(angA)); f(math.sin(angA));
f(math.cos(angB)); f(math.sin(angB));
```

These are time-only, so they are identical for every pixel. Computing them
in the fragment shader meant evaluating the same `sin`/`cos` 648k times a
frame — **measured at 0.7 ms of a native-resolution frame**. Passing them as
values costs nothing.

**`uLiftY` (61)** — how far up the screen the galaxy sits:

```dart
f(2.0 * liftLogicalPx / size.height);   // 64.0 logical px in this build
```

The shader only knows the offscreen buffer size, so it cannot convert logical
pixels itself. The dpr cancels out of `2·lift·dpr / (height·dpr)`, so this
form is exact on any device at any render scale.

---

## 6. The dive

Four phases, **7.0 s** total:

| Phase | Duration | What happens |
|---|---|---|
| Pulse | 1.0 s | haze dims to 50%, swells to 125%. Stars untouched — the contrast is what sells it |
| Zoom | 5.0 s | `uZoom` 1 → 0, tilt leans, rotation winds up |
| Hold | 1.0 s | black beat on the core |
| — | — | hard cut back to rest, by design |

**Zoom curve.** Ease strength runs `1.0` at the top of the plunge to `0.75`
from the middle onward, with a `p + 0.225·p·(1−p)` front-load:

```dart
final p0 = t / _zoomMs;
final p = p0 + _zoomLead * p0 * (1.0 - p0);
final ease = _zoomEaseStart + (_zoomEaseEnd - _zoomEaseStart) * p;
final pz = p + (p * p * (3.0 - 2.0 * p) - p) * ease;
```

A fixed ease of 0.75 leaves a quarter of the curve linear, and linear means
velocity on frame one: the zoom snapped to ~30% of its top speed in a single
tick. The variable ease leaves rest at zero speed, and by 700 ms it is within
1 %/s of the fixed-ease curve — the arrival is identical.

**Rotation must be ramped, not switched.** The rest phase runs at 1×; the
zoom phase's curve has a floor of 10×. Applied directly that is a step change
in angular velocity on one frame, and it reads as a jolt at the top of the
plunge far more than any depth-curve artefact:

```dart
final spinIn = _ss((e - _pulse) / 900.0);
final spinCurve = _spinMul * (5.0 + (_diveSpin - 5.0) * depth * depth * depth);
shaderTime += dt * (1.0 + (spinCurve - 1.0) * spinIn);
```

`_spinMul = 2.0`, `_diveSpin = 40.0` → 10× floor, 80× at the core.

**Camera tilt** eases 72.2° → 30° on `2^(10·(depth−1))`, an absolute floor
rather than a fraction of the resting tilt, so the plunge always lands at the
same angle. Nearly all of the swing is in the final second by design.

**Flares** wake at `uZoom < uFlareStart` and ramp over
`smoothstep(uFlareStart, uFlareStart*0.32, uZoom)`, leaving roughly a 2 s
finale. Both the main field and the floaters flare; floater strength has its
own hash, and zero flare is part of that distribution rather than a separate
subset.

---

## 7. Two traps that cost real debugging time

**`uMaxStarLod` is in LOD doublings, not zoom.** At 0.25 the lattice stops
refilling at `zoom = 2^-0.25 ≈ 0.84` — almost the whole dive. Past that the
field is *magnified*, not refilled, so stars grow at constant peak brightness
and each one emits light proportional to its area. Expect a bright, soft
field in the approach. Four fixes were prototyped (dim capped stars, dim by
magnification, sharpen the profile, shrink the size cap) and none shipped;
the behaviour is characterised, not solved.

**`rasterDuration` only measures real work when the work exceeds the frame
interval.** Below that, the raster thread blocks waiting for a buffer and the
number saturates at one vsync — so a load meter built on it reads ~100% while
the app is perfectly smooth. Verified by switching the gas *and* the entire
background starfield off at render scale 0.5: still 15.0 ms of a 16.7 ms
budget. Percentiles, median smoothing, a latching floor and an off-pipeline
`toImage()` probe were all tried; the probe queues behind the live frame and
reported 27 ms. **To compare cost, build with a feature off and on and
interleave the runs.** That is how the backdrop was shown to be free.

---

## 8. Performance

Render scale **0.5** (540×1200 on a 1080×2400 panel) is the default, not an
opt-in: at native resolution this shader costs ~28 ms per frame against a
16.7 ms budget. At 0.5 it holds 62 fps with headroom. The Flutter UI above it
still draws at full device resolution, so only the galaxy is softened.

Measured deltas at native scale on a Snapdragon 888:

| Feature | Cost |
|---|---|
| Background starfield | free (early-out on ~80% of pixels) |
| Nebula gas | ~0 (12 arithmetic hashes, no trig) |
| Gas rotation in-shader | 0.7 ms — moved to host uniforms |
| Star clearing around the galaxy | free (scales occupancy, so stars are never drawn) |

Two device notes carried over: **Impeller renders this black on Adreno**
(`EnableImpeller=false` in `AndroidManifest.xml`), and a project path
containing a space can make Flutter silently deploy a stale shader — if a
change has no effect, `rm -rf .dart_tool/flutter_build build/app/intermediates/flutter`
before debugging anything else.

---

## 9. Licence

Same as the rest of this repository.
