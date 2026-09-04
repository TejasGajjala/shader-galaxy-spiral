# Flutter implementation guide — spiral galaxy shader

How to run `galaxy.frag` as a Flutter `FragmentProgram`, and how to drive
the dive exactly as the editor does. The shader is a single pure fragment
pass — no textures, no extra passes, no vertex work.

### What is in this repo

| file | what it is |
|---|---|
| `galaxy.frag` | **The deliverable.** Ships in the app. |
| `galaxy_editor.html` | **The tuning tool.** Open in any browser: sliders, palette, dive, and a values block you can copy or paste back. Its shader body is *line-for-line identical* to `galaxy.frag`, so anything tuned here transfers verbatim. |
| `galaxy_editor_with_boom.html` | Reference only, not maintained. The earlier two-mode build (normal + a coloured "boom" state), kept so that palette and its mode-swap choreography are not lost. |
| `FLUTTER_IMPLEMENTATION.md` | This file. |

To change the look: open the editor, move sliders, press **Copy GLSL
values**, and paste the block into the ticket. Every value in it maps to a
row of the index table below. Nothing in the editor needs a build step.

## 1. Setup

`pubspec.yaml`:

```yaml
flutter:
  shaders:
    - shaders/galaxy.frag
```

Load once, reuse the shader object:

```dart
final program = await ui.FragmentProgram.fromAsset('shaders/galaxy.frag');
final shader  = program.fragmentShader();
```

## 2. Uniform index table

Flutter sets uniforms **by float index in declaration order** (`vec2` = 2
slots, `vec3` = 3). The order below matches `galaxy.frag` exactly — do not
reorder declarations there without rebuilding this table.

| idx | uniform | default (rest) | notes |
|----:|---------|----------------|-------|
| 0–1 | `iResolution` | canvas size | physical pixels (`size * dpr`) |
| 2 | `iTime` | clock | rotation clock, **not** wall time — §4 |
| 3 | `uZoom` | 1.0 | 1 = rest … →0 = dived |
| 4 | `uFade` | 1.0 | 0 = black. The dive does not drive it; host-only |
| 5 | `uRotSpeed` | 0.036 | spin speed |
| 6 | `uArmCount` | 2 |  |
| 7 | `uArmWinding` | 19.5 |  |
| 8 | `uArmSpacing` | 1.03 | where the turns sit; does not change their count |
| 9 | `uArmFalloff` | 0.70 | arm stars: outward density thinning (stars only) |
| 10 | `uArmSpread` | 0.69 | arm stars: outward band widening, plateau (stars only) |
| 11 | `uArmEdgeSkew` | 1.00 | hard inner edge / feathered outer edge (stars only) |
| 12 | `uRimCoarse` | 0.22 | outermost star band: thins AND carries it further out (stars only) |
| 13 | `uArmWobble` | 0.19 | static noise warp on the arm phase; stars + smoke together |
| 14 | `uArmSmoke` | 0.80 | haze: smoky filaments tracing the arms |
| 15 | `uSmokeSkew` | 0.62 | edge skew for the SMOKE arms |
| 16 | `uCoreGlow` | 1.00 | haze: broad glow at the nucleus |
| 17 | `uCoreGlowSpread` | 0.75 | core glow radial reach; intensity pinned |
| 18 | `uBulge` | 1.50 | stellar bulge strength |
| 19 | `uDiskThickness` | 1.35 | 0 = flat disk (cheapest path); default is thick — §11 |
| 20 | `uFlare` | 1.00 | diffraction spikes; alive only in the dive’s final stretch |
| 21 | `uHazePulse` | 1.0 | dive-start “come alive” beat, 1 = neutral |
| 22 | `uGasClouds` | 0.30 | drifting gas-cloud layer between windings |
| 23 | `uOvalness` | 1.09 |  |
| 24 | `uCamTilt` | 1.26 | radians off top-down; the dive drives this — §6 |
| 25 | `uCompactness` | 1.88 |  |
| 26 | `uStarDensity` | 3.68 |  |
| 27 | `uMaxStarLod` | 2.0 | caps star-grid refill during the dive |
| 28 | `uTwinkleFraction` | 0.00 |  |
| 29 | `uTwinkleSpeed` | 0.00 |  |
| 30 | `uTwinkleTime` | wall clock | wall clock — never the scaled `iTime` |
| 31 | `uPxSize` | 0.01285 | recompute on resize/zoom/tilt — §7 |
| 32 | `uBlackHoleSize` | 0.049 |  |
| 33–35 | `uNormalCenterColor` | 0.886, 0.878, 1.000 |  |
| 36–38 | `uNormalArmColor` | 0.639, 0.651, 1.000 |  |
| 39–41 | `uNormalHazeColor` | 1.000, 1.000, 1.000 |  |
| 42–44 | `uNormalStarColor` | 1.000, 1.000, 1.000 |  |
| 45 | `uCenterSpread` | 0.33 | how far the centre tint reaches |

Total: **46 floats**.

> **Single mode.** The product ships the resting spiral only, so
> `uColorTransition`, `uCoreMode`, `uCorona` and the four boom-palette
> colours are gone from the shader entirely. The `uNormal*` names are
> kept (rather than renamed to bare `uCenterColor` etc.) purely so this
> build stays diff-able against `galaxy_editor_with_boom.html`.

### Authoring aspect

Every default above was judged on a **392 × 840 canvas** (portrait, ~9:19.5
— the editor's phone frame minus its 14 px border). The shader corrects for
aspect internally, relative to exactly that ratio, so:

- at 392:840 the correction is exactly 1.0 and the render is bit-identical
  to the editor;
- at any other shape the galaxy **keeps its proportions** and stays inside
  the frame (extra empty space appears on the relatively longer axis)
  rather than stretching to fill.

Before that correction existed the scene stretched to whatever shape the
canvas was — the same uniforms gave a galaxy of width:height 1.53 at
9:19.5, 1.32 at 1:1 and 2.19 at 16:9, and on a square canvas it flattened
*and* overflowed both edges. That symptom reads as a camera-tilt problem
because a flattened disk is also what a steeper tilt looks like, so do not
"fix" it by touching `uCamTilt` — check `iResolution` first.

## 3. Painting

```dart
class GalaxyPainter extends CustomPainter {
  GalaxyPainter(this.shader, this.driver, this.dpr);
  final ui.FragmentShader shader;
  final GalaxyDriver driver;   // §4-§7
  final double dpr;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width * dpr, h = size.height * dpr;
    // NOTE: if the canvas is NOT drawn at physical resolution (no
    // canvas.scale(1/dpr)), pass logical pixels instead - iResolution
    // must match the coordinate space FlutterFragCoord() reports in.
    driver.upload(shader, w, h);   // sets all 61 floats
    canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(covariant GalaxyPainter old) => true; // animated
}
```

Drive repaints with a `Ticker`; feed its elapsed time to the driver.

## 4. The two clocks

The shader takes **two independent time uniforms**. Getting these right is
what makes the dive feel correct:

- **`uTwinkleTime` (idx 32)** — plain wall-clock seconds. Always advances
  at real time, even mid-dive.
- **`iTime` (idx 2)** — the rotation clock (`shaderTime`). It advances at
  **1× wall time at rest**, and during the zoom phase of the dive it runs
  at `5 × (1 + 3·depth³)` where `depth = 1 − zoom` — a Kepler-flavored
  spin-up from 5× to ~20× as the camera nears the core. Without it the
  late dive looks frozen. During the pulse and hold phases it drops back
  to 1×.

> **`iTime` is NOT wall-clock seconds.** Feeding it seconds-since-mount
> looks correct at rest — the two are identical there — and then silently
> breaks the moment a dive runs: the galaxy keeps spinning at 1× while the
> camera accelerates into it, and the late dive reads as frozen. Accumulate
> it as `shaderTime += dt * rotationRate` per frame instead of sampling an
> absolute clock. This has already caught one integration.

## 5. Dive choreography

One dive = three phases, timed from the tap (all ms):

```
tap ──► PULSE 1000 ──► ZOOM 4000 (ease-in-out) ──► HOLD 1000 ──► rest (instant)
```

The dive does **not** change mode. It returns to the resting view exactly
as it left — same palette, same core style — so `uColorTransition` and
`uCoreMode` are owned solely by the mode buttons. There is no fade-back
phase: at 6000 ms `zoom` and the tilt snap home in one frame, in plain
sight. Cover that cut at the app level if the dive is not navigating away.

Reference driver, mirroring the editor's `frame()` exactly:

```dart
class GalaxyDriver {
  double shaderTime = 0, twinkleTime = 0;
  double zoom = 1, fade = 1, hazePulse = 1;
  double camTiltSlider = 1.26;
  bool   diving = false;
  double _diveElapsedMs = 0;

  static const _pulse = 1000.0, _zoomMs = 4000.0, _hold = 1000.0;
  static const _zoomEase = 0.75; // ease-in-out strength; 0 = linear zoom
  // Peak rotation multiplier at the core; the dive always starts at 5x and
  // rides depth^3 up to this. 20 = the original fixed 5*(1+3*depth^3).
  // ~50 keeps tangential motion comparable to the radial rush through
  // zoom 0.25-0.05, the band that otherwise reads as stationary.
  static const _diveSpin = 50.0;
  static double _ss(double x) { x = x.clamp(0.0, 1.0); return x * x * (3 - 2 * x); }

  /// Plays the dive. The view comes back exactly as it left -- this build
  /// has a single mode, so there is nothing to swap.
  void startDive() {
    diving = true; _diveElapsedMs = 0;
  }

  /// dt = seconds since last tick.
  void tick(double dt) {
    twinkleTime += dt;            // always real-time
    hazePulse = 1.0;
    if (!diving) { shaderTime += dt; return; }

    _diveElapsedMs += dt * 1000;
    final e = _diveElapsedMs;
    if (e < _pulse) {
      // "Come alive": haze dims to 50% and swells back to 125%.
      // Stars are untouched - that contrast is what sells it.
      shaderTime += dt;
      final pp = e / _pulse;
      hazePulse = pp < 0.45
          ? 1.0 - 0.50 * _ss(pp / 0.45)
          : 0.50 + 0.75 * _ss((pp - 0.45) / 0.55);
      zoom = 1; fade = 1;
    } else if (e < _pulse + _zoomMs) {
      final depth = 1.0 - zoom;
      shaderTime += dt * (5.0 + (_diveSpin - 5.0) * depth * depth * depth);
      final t = e - _pulse;
      // Ease-in-out: blend a smoothstep S-curve into linear progress so
      // the dive starts slow, runs quickest through the middle, and eases
      // into the finale. _zoomEase = 0 is the old linear zoom; 1 is full
      // smoothstep (zero velocity at both ends -> reads as a stall). 0.75
      // keeps a live starting velocity. Endpoints/duration unchanged.
      final p = t / _zoomMs;
      final pz = p + (p * p * (3.0 - 2.0 * p) - p) * _zoomEase;   // _zoomEase = 0.75
      zoom = (1.0 - pz).clamp(0.0001, 1.0);
      hazePulse = 1.0 + 0.25 * (1.0 - t / 800).clamp(0.0, 1.0); // settle overshoot
      fade = 1;
    } else if (e < _pulse + _zoomMs + _hold) {
      shaderTime += dt;
      zoom = 0.0001; fade = 1;                          // black beat on the core
    } else {
      // Straight back to rest, same mode. zoom and tilt snap home in one
      // frame with no black to cover it -- intended.
      shaderTime += dt;
      diving = false; zoom = 1; fade = 1;               // re-enable the button here
    }
  }
}
```

## 6. Dive camera tilt

The camera leans toward top-down as it closes in — exponential ease-in on
zoom progress, so the whole descent lands in the final stretch. The floor
is an **absolute 40°** off top-down, not a fraction of the slider, so the
plunge lands at the same angle whatever the resting tilt is (clamped to
the slider, so a tilt already below 40° is never tilted UP). Full top-down
loses the oblique stretch and lets the hole swallow the finale.

```dart
double currentTilt() {
  final dp = (1.0 - zoom).clamp(0.0, 1.0);
  const e0 = 1.0 / 1024.0;                       // 2^-10
  final eased = (math.pow(2.0, 10.0 * (dp - 1.0)) - e0) / (1.0 - e0);
  const floorRad = 40.0 * math.pi / 180.0;       // absolute 40 deg
  final tiltFloor = math.min(camTiltSlider, floorRad);
  return camTiltSlider + (tiltFloor - camTiltSlider) * eased;  // -> uCamTilt (idx 26)
}
```

Normalized so `zoom = 1` gives exactly the slider value. With the
fade-back phase gone, the return to rest snaps the tilt home in one
visible frame.

## 7. uPxSize (star anti-alias floor)

Recompute whenever zoom, tilt, or canvas size changes:

```dart
double pxSize(double w, double h) =>
    3.3 * zoom * math.max(1.0 / w, 1.0 / (h * math.cos(currentTilt())));
```

(3.3 = 2 × the shader's 1.65 framing constant; `cos(tilt)` approximates
the perspective foreshortening of the old squash factor.)

## 8. Performance notes

- **Flat disk is the fast path.** `uDiskThickness = 0` renders the
  single-plane starfield; > 0 pays for the height-sheet loop, whose count
  is `ceil(2T - 1)` — 2 sheets at the 1.35 default, capped at 8. Measured
  by ablation, the thick path is **~51 % of the rest frame**.
- **The frame gets cheaper as the dive darkens.** Haze, gas clouds, and
  dust warp are all uniform-gated: the clouds are skipped past mid-dive,
  the smoke past `uZoom < 0.03`, and a far-field early-out skips the whole
  galaxy stack for sky/background pixels.
- **Resolution is the biggest lever.** The shader is fill-rate bound. If
  low-end devices struggle, render the `CustomPaint` at a capped DPR
  (e.g. 2.0) — or drop DPR only while `diving` is true, when motion hides
  the softness. Keep `iResolution`/`uPxSize` in the same pixel space you
  actually render at.
- **Halve the frame rate at rest.** At rest the only motion is the slow
  0.036 rad/s rotation (twinkle is off by default), so consecutive 60 fps
  frames are nearly identical — paint at 30 fps at rest and full 60 only
  while `diving`. Halves average GPU load and battery with zero per-frame
  quality change (this is scheduling, not rendering). The driver already
  takes real `dt`, so skipped ticks accumulate correctly:

  ```dart
  // In the Ticker callback:
  _tick++;
  if (!driver.diving && _tick.isOdd) return;   // 30 fps at rest
  driver.tick(dtSinceLastPaintedFrame);
  repaint();
  ```

  Paint immediately on user interaction (slider edits, mode switches) so
  controls never feel laggy, and drop the throttle the moment
  `startDive()` runs — the pulse must land at full rate.
- Zero-value uniforms (`uDiskThickness`, `uTwinkleSpeed`, `uGasClouds`, …)
  cost nothing: their branches are uniform-coherent and
  fully skipped.
- **Haze cost is per-layer on/off, not proportional.** Slider values are
  post-multipliers; the noise runs at any value above 0. Exactly 0 trips
  the skip: `uArmSmoke` + `uCoreGlow` share one gate — both must be 0 to
  skip their smoke pass.

## 9. If it is too heavy — the playbook

Work down this list and **measure after each step**; stop when you hit
frame budget. The shares are from ablation on a fixed rig (software
raster) — treat the *ordering* and *ratios* as reliable, the absolute
numbers as indicative.

Where the frame actually goes at the shipped defaults:

| | share |
|---|---:|
| star lattice (all forms) | **~76 %** |
| smoke stack | ~5 % |
| camera/ray + masks + core + gas + dither + colour | ~17 % |

So anything that reduces **pixels** or **star-lattice passes** matters;
tuning the other sliders does not.

| # | change | where | expected | cost |
|---|---|---|---|---|
| 1 | **Cap render DPR** (try 2.0, then 1.5) | Flutter | Fill-rate scales with pixel count — 3× DPR on a 392×840 logical canvas is ~3.0 Mpx. Going to 2× is **~55 % fewer pixels**. Nothing else comes close. | mild softness |
| 2 | **30 fps at rest**, 60 only while diving | Flutter | halves average load and battery | none per frame |
| 3 | `uDiskThickness = 0` | uniform | ~51 % of the rest frame | loses the 3D slab — the disk goes flat |
| 4 | `uMaxStarLod = 1.0` | uniform | flattens the mid-dive spike (the LOD cross-fade is the costliest frame, ~2.3× rest) | late dive refills fewer stars |
| 5 | `uArmSmoke` **and** `uCoreGlow` = 0 | uniform | ~5 % | nebula loses filaments and nucleus glow |

**Steps 1 and 2 are worth more than every uniform change combined**, and
neither touches the look at rest. Do them first. If 1 + 2 are already in
and it is still heavy, the honest answer is that the device cannot afford
this shader at that resolution — step 3 is the next real cut, and it is a
visible one.

### What will NOT help

Tuning `uArmWobble`, `uCorona`, `uGasClouds`, `uTwinkleFraction` or
`uStarDensity`: all measured at or below the noise floor. `uStarDensity`
in particular changes the lattice *spacing*, not the number of cells
walked, so it is not a cost lever at all.

Micro-optimising the shader further: three separate exact ALU reductions
(a redundant `sqrt`, six integer-exponent `pow` calls, two provably-dead
hashes, and a conservative per-cell early reject) were implemented and
measured — **all within noise**. They are kept because they are free, but
the lattice is not ALU-bound on the test rig. If a real-device profile
says otherwise, that is new information worth acting on; without one,
there is nothing left to cut in-shader that does not cost appearance
(see §10).

### To get more specific help

A device profile beats any guess made here. Useful to know: which device
and OS; whether the load is at **rest** or during the **dive**; the actual
frame time or fps; and the DPR you are rendering at. Rest-heavy and
dive-heavy have different fixes — rest points at steps 1–3, dive at
step 4.

## 10. Low-battery / power-saver mode

On low battery the OS throttles CPU/GPU clocks (and iOS Low Power Mode
caps ProMotion to 60 Hz), so the SAME shader suddenly drops frames — the
fix is to lower work per frame, not to fight the throttle. Detect it with
`battery_plus` (`isInBatterySaveMode`, `batteryLevel`) — prefer reacting
to the OS battery-saver FLAG (user intent) over a raw percentage; if
using a percentage, ≤ 20 % is a sane default. Apply steps in order; each
is independent and reversible when power returns:

| step | change | saves | visible cost |
|---|---|---|---|
| 1 | Rest frame pacing 30 → 24 fps (dive 60 → 30) | large, battery-first | none per frame; dive slightly less silky |
| 2 | `uArmSmoke` **and** `uCoreGlow` = 0 | skips the smoke pass (~5 % of the rest frame, measured) | nebula loses its filaments and its nucleus glow |
| 3 | Cap render DPR at 2.0 (or 1.5) | biggest single lever (fill-rate scales with pixel count) | mild softness, hidden by motion |
| 4 | `uDiskThickness = 0` | **~51 %** of the rest frame (measured) | 3D rim/parallax gone — flat but clean look |
| 5 | `uMaxStarLod = 1.0` | flattens the mid-dive cost spike (the LOD cross-fade is the most expensive frame) | late dive refills fewer stars |

Steps 1–3 are a good "battery saver" preset; 4–5 are the deep fallback
for genuinely weak/hot devices. Do NOT dim stars or drop `uTwinkleTime`
updates — star brightness is the look's backbone, and twinkle is already
near-free. Remember to keep `iResolution`/`uPxSize` consistent with the
DPR you actually render at (§7), and restore everything when
`isInBatterySaveMode` clears.

## 11. Constraints — things that look like optimisations and are not

Each of these was implemented, measured and reverted. They are recorded so
the same ground is not re-covered.

**The bulge must keep its own height.** `hBulge` is 3x `hDisk`, which means
each sheet runs two lattice walks instead of one. Merging them onto a
single walk is worth ~22% of the frame — and it visibly flattens the core,
thinning the diffuse scatter that sits *off* the disk plane. The extra
height is load-bearing.

**The arm envelope must be evaluated per sheet.** Every sheet rebuilds
`armAngleMask` / `armRadialFade` / `armDissolve` / `armStarKeep` at its own
footprint, which looks redundant. It is not: the mask *position* carries
thickness. Hoisting it to the mid-plane pins the arm band, so only stars
inside a fixed band can shift and the arms stop thickening with the slider
while the bulge keeps spreading. Ablation later showed those masks cost
~1 ms anyway.

**Camera roll is the wrong tool for "the dive looks static."** Rolling the
frame turns the whole picture, not the arms. Camera *orbit* is worse still
— for an axisymmetric disk it is mathematically identical to counter-
rotating the pattern, i.e. exactly what `uRotSpeed` already does. The lever
that works is `_diveSpin` (§5).

**The dive tilt curve is deliberately exponential.** Making it linear
spreads the descent evenly, which flattens the shot early and drains the
plunge of its moment.

### Where the time actually goes (measured by ablation)

| | share of frame |
|---|---:|
| star lattice, all forms | ~76% |
| smoke stack | ~5% |
| camera/ray + masks + core + gas + dither + colour | ~17% |

The arm masks, gas clouds, corona, wobble and twinkle are all at or below
the noise floor — tuning them buys nothing. The only in-shader lever with
real headroom left is the per-cell early reject in the star lattice
(reject on distance before computing size/radius/attenuation). Everything
else worth having is host-side: **render resolution**, which scales all of
the above, and **30 fps pacing at rest** (§8).
