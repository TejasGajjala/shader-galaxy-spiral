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
| 5 | `uRotSpeed` | 0.05 | spin speed |
| 6 | `uColorTransition` | 0.0 | 0 = normal palette, 1 = boom palette |
| 7 | `uArmCount` | 2.0 | |
| 8 | `uArmWinding` | 16.0 | |
| 9 | `uArmSpacing` | 1.12 | |
| 10 | `uHaze` | 0.84 | nebula body visibility |
| 11 | `uBulge` | 0.5 | |
| 12 | `uDiskThickness` | 1.35 | 0 = flat disk (cheapest path); default is thick |
| 13 | `uFlare` | 0.6 | star diffraction flares, final dive stretch |
| 14 | `uHazePulse` | 1.0 | "come alive" beat, host-driven — §5 |
| 15 | `uGasClouds` | 0.23 | drifting gas-cloud layer between windings |
| 16 | `uOvalness` | 1.0 | |
| 17 | `uCamTilt` | 1.27 | radians off top-down; dive-animated — §6 |
| 18 | `uCompactness` | 1.5 | |
| 19 | `uStarDensity` | 4.0 | |
| 20 | `uMaxStarLod` | 2.0 | star refill cap during the dive |
| 21 | `uTwinkleFraction` | 0.14 | |
| 22 | `uTwinkleSpeed` | 0.0 | 0 = twinkle off |
| 23 | `uTwinkleTime` | clock | wall-clock seconds, always real-time |
| 24 | `uPxSize` | computed | AA floor — §7 |
| 25 | `uCoreMode` | 0.0 | 0 = black hole, 1 = white core |
| 26 | `uBlackHoleSize` | 0.049 | |
| 27–29 | `uCenterColor` | 0.294, 0.376, 0.569 | boom palette |
| 30–32 | `uArmColor` | 0.0, 0.482, 1.0 | boom |
| 33–35 | `uOuterHazeColor` | 0.259, 0.345, 1.0 | boom |
| 36–38 | `uStarColor` | 1.0, 1.0, 1.0 | boom |
| 39–41 | `uNormalCenterColor` | 0.886, 0.878, 1.0 | normal palette |
| 42–44 | `uNormalArmColor` | 0.639, 0.651, 1.0 | normal |
| 45–47 | `uNormalHazeColor` | 1.0, 1.0, 1.0 | normal |
| 48–50 | `uNormalStarColor` | 1.0, 1.0, 1.0 | normal |
| 51 | `uCenterSpread` | 0.5 | |

Total: 52 floats.

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
    driver.upload(shader, w, h);   // sets all 53 floats
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

- **`uTwinkleTime` (idx 24)** — plain wall-clock seconds. Always advances
  at real time, even mid-dive.
- **`iTime` (idx 2)** — the rotation clock (`shaderTime`). It advances at
  **1× wall time at rest**, and during the zoom phase of the dive it runs
  at `5 × (1 + 3·depth³)` where `depth = 1 − zoom` — a Kepler-flavored
  spin-up from 5× to ~20× as the camera nears the core. Without it the
  late dive looks frozen. During the pulse/hold/fade phases it drops back
  to 1×.

## 5. Dive choreography

One dive = four phases, timed from the tap (all ms):

```
tap ──► PULSE 1000 ──► ZOOM 5000 (linear) ──► HOLD 700 ──► FADE 1500 ──► rest
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
      zoom = (1.0 - t / _zoomMs).clamp(0.0001, 1.0);   // LINEAR - eased reads worse
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
  return camTiltSlider * (1.0 - 0.40 * eased);   // -> uCamTilt (idx 18)
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
- Zero-value uniforms (`uDiskThickness`, `uTwinkleSpeed`, `uGasClouds`, …)
  cost nothing: their branches are uniform-coherent and
  fully skipped.

## 9. Palette / mode cheat sheet

- **Normal mode**: `uColorTransition = 0`, `uCoreMode = 0` (black hole),
  normal palette at indices 40–51.
- **Boom mode**: `uColorTransition = 1`, `uCoreMode = 1` (white core),
  boom palette at indices 28–39.
- A dive **into** boom: start in normal, `startDive(toBoom: true)` — the
  palette and core swap happen automatically behind the fade. The editor's
  instant-mode buttons are just these same swaps without the dive.
