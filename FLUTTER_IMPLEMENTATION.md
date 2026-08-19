# Flutter implementation guide — spiral galaxy shader

How to run `galaxy.frag` (the Flutter port of `galaxy_shader_V1.3.glsl`,
itself exported verbatim from `galaxy_editor_1.html`) as a Flutter
`FragmentProgram`, and how to drive the dive animation exactly like the
editor does. The shader is a single pure fragment pass — no textures, no
extra passes, no vertex work.

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
| 4 | `uFade` | 1.0 | 0 = black, used by the fade-back phase |
| 5 | `uRotSpeed` | 0.036 | spin speed |
| 6 | `uColorTransition` | 0.0 | 0 = normal palette, 1 = boom palette |
| 7 | `uArmCount` | 2 |  |
| 8 | `uArmWinding` | 18.5 |  |
| 9 | `uArmSpacing` | 1.12 | where the turns sit; does not change their count |
| 10 | `uArmFalloff` | 0.70 | arm stars: outward density thinning (stars only) |
| 11 | `uArmSpread` | 0.69 | arm stars: outward band widening, plateau (stars only) |
| 12 | `uArmEdgeSkew` | 1.0 | arm stars: hard inner edge / feathered outer (stars only) |
| 13 | `uRimCoarse` | 0.26 | outermost star band: thins AND carries it further out (stars only) |
| 14 | `uArmWobble` | 0.19 | static noise warp on the arm phase; windings wander, stars+smoke together |
| 15 | `uArmSmoke` | 0.74 | haze: smoky filaments tracing the arms |
| 16 | `uSmokeSkew` | 0.62 | edge skew for the SMOKE arms (no width plateau); 0 = symmetric |
| 17 | `uCoreGlow` | 1.0 | haze: broad bright glow at the nucleus |
| 18 | `uCoreGlowSpread` | 0.74 | core glow radial reach; intensity stays pinned |
| 19 | `uCorona` | 0.80 | haze: tight core bloom (BOOM MODE only) |
| 20 | `uBulge` | 1.5 | grows the radius of the packed central cluster |
| 21 | `uDiskThickness` | 1.35 | 0 = flat disk (cheapest path); default is thick |
| 22 | `uFlare` | 1.0 | star diffraction flares, final dive stretch |
| 23 | `uHazePulse` | 1.0 | "come alive" beat, host-driven — §5 |
| 24 | `uGasClouds` | 0.15 | drifting gas-cloud layer between windings |
| 25 | `uOvalness` | 1.05 |  |
| 26 | `uCamTilt` | 1.26 | radians off top-down; dive-animated — §6 |
| 27 | `uCompactness` | 1.88 |  |
| 28 | `uStarDensity` | 3.48 |  |
| 29 | `uMaxStarLod` | 2.0 | star refill cap during the dive |
| 30 | `uTwinkleFraction` | 0.14 |  |
| 31 | `uTwinkleSpeed` | 0.0 | 0 = twinkle off (static per-star offsets) |
| 32 | `uTwinkleTime` | clock | wall-clock seconds, always real-time |
| 33 | `uPxSize` | computed | AA floor — §7 |
| 34 | `uCoreMode` | 0 | 0 = black hole, 1 = white core |
| 35 | `uBlackHoleSize` | 0.049 |  |
| 36–38 | `uCenterColor` | 0.294, 0.376, 0.569 | boom palette |
| 39–41 | `uArmColor` | 0.000, 0.482, 1.000 | boom |
| 42–44 | `uOuterHazeColor` | 0.259, 0.345, 1.000 | boom |
| 45–47 | `uStarColor` | 1.000, 1.000, 1.000 | boom |
| 48–50 | `uNormalCenterColor` | 0.886, 0.878, 1.0 | normal palette |
| 51–53 | `uNormalArmColor` | 0.639, 0.651, 1.0 | normal |
| 54–56 | `uNormalHazeColor` | 1.0, 1.0, 1.0 | normal |
| 57–59 | `uNormalStarColor` | 1.0, 1.0, 1.0 | normal |
| 60 | `uCenterSpread` | 0.5 |  |

Total: 61 floats.

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
  late dive looks frozen. During the pulse/hold/fade phases it drops back
  to 1×.

> **`iTime` is NOT wall-clock seconds.** Feeding it seconds-since-mount
> looks correct at rest — the two are identical there — and then silently
> breaks the moment a dive runs: the galaxy keeps spinning at 1× while the
> camera accelerates into it, and the late dive reads as frozen. Accumulate
> it as `shaderTime += dt * rotationRate` per frame instead of sampling an
> absolute clock. This has already caught one integration.

## 5. Dive choreography

One dive = four phases, timed from the tap (all ms):

```
tap ──► PULSE 1000 ──► ZOOM 5000 (ease-in-out) ──► HOLD 700 ──► FADE 1500 ──► rest
```

Reference driver, mirroring the editor's `frame()` exactly:

```dart
class GalaxyDriver {
  double shaderTime = 0, twinkleTime = 0;
  double zoom = 1, fade = 1, hazePulse = 1;
  double colorTransition = 0, coreMode = 0, camTiltSlider = 1.27;
  bool   diving = false;
  double _diveElapsedMs = 0, _target = 1;

  static const _pulse = 1000.0, _zoomMs = 5000.0, _hold = 700.0, _fade = 1500.0;
  static const _zoomEase = 0.75; // ease-in-out strength; 0 = linear zoom
  static double _ss(double x) { x = x.clamp(0.0, 1.0); return x * x * (3 - 2 * x); }

  void startDive({required bool toBoom}) {
    diving = true; _diveElapsedMs = 0; _target = toBoom ? 1 : 0;
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
      shaderTime += dt * 5.0 * (1.0 + 3.0 * depth * depth * depth);
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
    } else if (e < _pulse + _zoomMs + _hold + _fade) {
      shaderTime += dt;
      // Swaps hidden behind black: palette, core style, zoom + tilt home.
      colorTransition = _target;
      coreMode = _target > 0.5 ? 1 : 0;
      zoom = 1;
      fade = ((e - (_pulse + _zoomMs + _hold)) / _fade).clamp(0.0, 1.0);
    } else {
      shaderTime += dt;
      diving = false; zoom = 1; fade = 1;               // re-enable the button here
    }
  }
}
```

## 6. Dive camera tilt

The camera leans toward top-down as it closes in — exponential ease-in on
zoom progress, so the whole descent lands in the final stretch. The floor
is **60% of the resting tilt** (~44° with the 1.27 default): full top-down
loses the oblique stretch and lets the hole swallow the finale.

```dart
double currentTilt() {
  final dp = (1.0 - zoom).clamp(0.0, 1.0);
  const e0 = 1.0 / 1024.0;                       // 2^-10
  final eased = (math.pow(2.0, 10.0 * (dp - 1.0)) - e0) / (1.0 - e0);
  return camTiltSlider * (1.0 - 0.40 * eased);   // -> uCamTilt (idx 26)
}
```

Normalized so `zoom = 1` gives exactly the slider value; the fade phase
resets `zoom` to 1 behind black, which snaps the tilt home invisibly.

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
  original single-plane starfield; > 0 pays for two extra star sheets.
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
  0.05 rad/s rotation (twinkle speed defaults to 0), so consecutive 60 fps
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
  the skip: `uArmSmoke`+`uCoreGlow` share one gate (both must be 0 to skip their
  smoke pass), `uCorona` is ~free.

## 9. Low-battery / power-saver mode

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
| 2 | `uArmSmoke` or `uCoreGlow` = 0 | skips the smoke pass when BOTH are 0 (~10 % of the rest frame) | nebula loses its filaments or its nucleus glow |
| 3 | Cap render DPR at 2.0 (or 1.5) | biggest single lever (fill-rate scales with pixel count) | mild softness, hidden by motion |
| 4 | `uDiskThickness = 0` | ~20 % of the rest frame (flat star path) | 3D rim/parallax gone — flat but clean look |
| 5 | `uMaxStarLod = 1.0` | flattens the mid-dive cost spike (the LOD cross-fade is the most expensive frame) | late dive refills fewer stars |

Steps 1–3 are a good "battery saver" preset; 4–5 are the deep fallback
for genuinely weak/hot devices. Do NOT dim stars or drop `uTwinkleTime`
updates — star brightness is the look's backbone, and twinkle is already
near-free. Remember to keep `iResolution`/`uPxSize` consistent with the
DPR you actually render at (§7), and restore everything when
`isInBatterySaveMode` clears.

## 10. Palette / mode cheat sheet

- **Normal mode**: `uColorTransition = 0`, `uCoreMode = 0` (black hole),
  normal palette at indices 48–59.
- **Boom mode**: `uColorTransition = 1`, `uCoreMode = 1` (white core),
  boom palette at indices 36–47.
- A dive **into** boom: start in normal, `startDive(toBoom: true)` — the
  palette and core swap happen automatically behind the fade. The editor's
  instant-mode buttons are just these same swaps without the dive.
