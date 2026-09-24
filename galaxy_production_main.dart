import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(children: [Positioned.fill(child: GalaxyView())]),
      ),
    );
  }
}

/// Rest-state defaults for the richer second shader (`shaders/galaxy_dot.frag`),
/// taken verbatim from the uniform index table in that shader's own
/// FLUTTER_IMPLEMENTATION.md. This build is single-mode: it has no boom
/// palette and no black-hole/white-core swap, so there is nothing to toggle
/// — only the dive.
class _GalaxyDotDefaults {
  static const rotSpeed = 0.030;
  static const armCount = 2.0;
  static const armWinding = 19.5;
  static const armSpacing = 1.03;
  static const armFalloff = 0.70;
  static const armSpread = 1.00; // tuned (repo default 0.69)
  static const armEdgeSkew = 0.75; // tuned (repo default 1.00)
  static const rimCoarse = 0.22;
  static const armWobble = 0.19;
  static const armSmoke = 0.80;
  static const smokeSkew = 0.46; // tuned (repo default 0.62)
  static const coreGlow = 1.00;
  static const coreGlowSpread = 0.75;
  static const bulge = 1.50;
  // Tuned down from the repo's 1.35. Sheet count is ceil(2T-1), so this
  // drops the height-sheet loop that ablation measured at ~72% of the frame.
  static const flare = 1.00;
  static const gasClouds = 0.3375; // 0.45 less 25% (repo default was 0.30)
  static const ovalness = 1.00;
  static const camTilt = 1.26;
  static const compactness = 1.88;
  static const starDensity = 3.00; // tuned (repo default 3.68)
  // Lowered from 2.0: the dive now stops refilling the lattice sooner, so
  // stars magnify into distinct points instead of staying fine grain --
  // the flares need something big enough to flare on.
  static const maxStarLod = 0.25;
  static const twinkleFraction = 0.00;
  static const twinkleSpeed = 0.00;
  static const blackHoleSize = 0.040;
  static const centerSpread = 0.33;
  static const centerColor = <double>[0.886, 0.878, 1.000];
  static const armColor = <double>[0.639, 0.651, 1.000];
  static const hazeColor = <double>[1.000, 1.000, 1.000];
  static const starColor = <double>[1.000, 1.000, 1.000];
}

/// Drives `galaxy_dot.frag`, mirroring the reference driver in that shader's
/// implementation guide (its sections 4–7).
///
/// Two independent clocks matter here: [twinkleTime] is always wall-clock,
/// while [shaderTime] is a *rotation* clock that accelerates during the dive
/// (5x up to 50x on depth^3). Feeding [shaderTime] plain seconds looks right
/// at rest and then reads as frozen mid-dive.
class GalaxyDotDriver {
  double shaderTime = 0;
  double twinkleTime = 0;
  double zoom = 1;
  double fade = 1;
  double hazePulse = 1;
  double camTiltSlider = _GalaxyDotDefaults.camTilt;

  /// Camera tilt the plunge lands on, in radians. An ABSOLUTE floor, not a
  /// fraction of the resting tilt, so the dive always ends at the same angle
  /// however uCamTilt is set. Driven by the tuning sheet.
  double diveFloorRad = 30.0 * math.pi / 180.0;
  bool diving = false;
  double _diveElapsedMs = 0;

  // Plunge 4s -> 6s -> 5s. The 6s version spent too long in the shallow
  // approach; the second comes off the front, not the finale.
  // Zoom carries the extra 300ms itself rather than a held beat before it:
  // the plunge starts gentler and takes longer to get going, which separates
  // it from the pulse without anything actually stopping.
  // Back to 5.0s. The 300ms that went in as a held beat, then as extra zoom
  // length, then as a reshaped curve was solving the wrong problem: the
  // opening did not need more TIME, it needed to leave rest gently. Duration
  // and pacing are the originals; only the first moment is different.
  static const _pulse = 1000.0, _zoomMs = 5000.0, _hold = 1000.0;
  /// Ease strength across the plunge: a full smoothstep at the top, the
  /// original 0.75 from the middle onward. 0.75 leaves a quarter of the curve
  /// linear, and linear means speed on frame one -- the zoom used to snap to
  /// ~30% of top speed in a single tick. Only that first moment needed
  /// fixing, so only that is changed; by 700ms this curve and the original
  /// are within 1%/s of each other, and the arrival is identical.
  static const _zoomEaseStart = 1.0, _zoomEaseEnd = 0.75;

  /// Front-loads depth so the shortened zoom loses its second from the
  /// shallow part and the deep finale keeps the pace it had.
  ///
  /// Applied as `p + k*p*(1-p)`, NOT as pow(p, 0.8). A power curve hits the
  /// same depth marks but its slope is infinite at p = 0, so the plunge would
  /// snap into motion on frame one -- exactly the abruptness to avoid. This
  /// form leaves both endpoints alone and lifts the middle, so the start is
  /// 1.25x quicker rather than instantaneous.
  ///
  /// Front-loads depth. 0.225, re-solved from the original 0.245 so that the
  /// gentler opening still reaches the flare depth at t = 3.16s -- within 2ms
  /// of where the original 5.0s curve put it.
  static const _zoomLead = 0.225;
  static const _diveSpin = 40.0; // peak rotation multiplier at the core

  /// Flat multiplier on the whole dive-spin curve. Scales it without
  /// reshaping it: the 5x floor and the cubic ramp into the core are exactly
  /// as they were, every value simply 3x larger.
  static const _spinMul = 2.0;

  static double _ss(double x) {
    x = x.clamp(0.0, 1.0);
    return x * x * (3 - 2 * x);
  }

  void startDive() {
    diving = true;
    paused = false;
    _diveElapsedMs = 0;
  }

  /// dt = seconds since the last tick.
  /// Holds the dive at its current depth. The rotation clock keeps running so
  /// the galaxy still turns while paused -- a frozen frame reads as a bug,
  /// a slowly turning one reads as a held shot.
  bool paused = false;

  void togglePause() => paused = !paused;

  void tick(double dt) {
    twinkleTime += dt; // always real-time, even mid-dive
    hazePulse = 1.0;
    if (!diving) {
      shaderTime += dt;
      return;
    }
    if (paused) {
      shaderTime += dt;
      return; // depth held: _diveElapsedMs does not advance
    }

    _diveElapsedMs += dt * 1000;
    final e = _diveElapsedMs;
    if (e < _pulse) {
      // "Come alive": haze dims to 50% then swells to 125%. Stars untouched —
      // that contrast is what sells it.
      shaderTime += dt;
      final pp = e / _pulse;
      hazePulse = pp < 0.45
          ? 1.0 - 0.50 * _ss(pp / 0.45)
          : 0.50 + 0.75 * _ss((pp - 0.45) / 0.55);
      zoom = 1;
      fade = 1;
    } else if (e < _pulse + _zoomMs) {
      final depth = 1.0 - zoom;
      // Ease the spin IN from the resting rate. The curve's floor is 5x,
      // doubled to 10x by _spinMul, so the first tick of this phase used to
      // jump straight from 1x to 10x -- a step change in angular velocity on
      // one frame, which is the jolt at the top of the plunge. The depth
      // curve was never the sudden part. Blending over the first 900ms lets
      // the galaxy wind up instead of being kicked.
      final spinIn = _ss((e - _pulse) / 900.0);
      final spinCurve =
          _spinMul * (5.0 + (_diveSpin - 5.0) * depth * depth * depth);
      shaderTime += dt * (1.0 + (spinCurve - 1.0) * spinIn);
      final t = e - _pulse;
      final p0 = t / _zoomMs;
      final p = p0 + _zoomLead * p0 * (1.0 - p0);
      final ease = _zoomEaseStart + (_zoomEaseEnd - _zoomEaseStart) * p;
      final pz = p + (p * p * (3.0 - 2.0 * p) - p) * ease;
      zoom = (1.0 - pz).clamp(0.0001, 1.0);
      hazePulse = 1.0 + 0.25 * (1.0 - t / 800).clamp(0.0, 1.0);
      fade = 1;
    } else if (e < _pulse + _zoomMs + _hold) {
      shaderTime += dt;
      zoom = 0.0001; // black beat on the core
      fade = 1;
    } else {
      // Straight back to rest — zoom and tilt snap home in one frame, in
      // plain sight. That hard cut is intended by the reference design.
      shaderTime += dt;
      diving = false;
      paused = false;
      zoom = 1;
      fade = 1;
    }
  }

  /// The camera leans toward top-down as it closes in (exponential ease-in on
  /// dive progress). The floor is an absolute 40°, not a fraction of the
  /// resting tilt, so the plunge always lands at the same angle.
  double currentTilt() => tiltAt(zoom);

  /// Tilt for an arbitrary zoom, so a pinned dive depth can be rendered
  /// exactly as the live dive would render it.
  double tiltAt(double z) {
    final dp = (1.0 - z).clamp(0.0, 1.0);
    const e0 = 1.0 / 1024.0; // 2^-10
    final eased =
        (math.pow(2.0, 10.0 * (dp - 1.0)).toDouble() - e0) / (1.0 - e0);
    final tiltFloor = math.min(camTiltSlider, diveFloorRad);
    return camTiltSlider + (tiltFloor - camTiltSlider) * eased;
  }

  /// Star anti-alias floor: the p-space size of one rendered pixel.
  /// 3.3 = 2x the shader's 1.65 framing constant; cos(tilt) approximates the
  /// perspective foreshortening. Pass PHYSICAL pixels — see [GalaxyDotPainter].
  double pxSize(double w, double h) => pxSizeAt(zoom, w, h);

  double pxSizeAt(double z, double w, double h) =>
      3.3 * z * math.max(1.0 / w, 1.0 / (h * math.cos(tiltAt(z))));
}

/// Live tuning state for the advanced shader, expressed as uniform-index
/// overrides applied on top of [_GalaxyDotDefaults]. Backs the tuning sheet
/// so features can be toggled and swept on-device without a rebuild.
class _Tuning {
  /// 540x1200. Native has never held the frame budget on the test device,
  /// so this is the real default rather than an opt-in.
  double renderScale = 0.5;

  /// Off-plane floater height for the FLAT path (shader index 46).
  /// 0 = upstream behaviour. The cheap 3D cue: real parallax, sparse stars.
  double flatFloaters = 1.7;

  /// Floater lattice density (shader index 47). Upstream hardcodes 5.
  /// Higher = more off-plane stars, at ~no extra per-pixel cost.
  double floaterDensity = 30.0;

  /// Overall floater star size (shader index 48). 1.0 = default.
  double floaterSize = 1.0;

  /// Floater reach as a radius multiplier on the bulge gaussian (index 49).
  /// 1.0 = exactly the bulge's spread; 1.1 = ~10% beyond it.
  double floaterSpread = 1.5;

  /// Grid refill cap (uMaxStarLod). Lower = the dive stops adding finer star
  /// levels sooner, so stars magnify into fewer, larger, distinct points.
  double maxStarLod = _GalaxyDotDefaults.maxStarLod;

  /// Dive depth at which flares switch on (uFlareStart). Higher = they start
  /// earlier in the plunge and stay longer, at the cost of more lit pixels.
  double flareStart = 0.25;

  /// Distant background stars. Count 0 = none at all, which is the state
  /// the shader was in before they were re-added.
  double bgCount = 0.24;
  double bgSize = 0.15;

  /// Faint gas between the background stars (shader index 52). 0 = off and
  /// fully skipped -- it is the only full-screen addition here.
  double nebula = 0.60;

  /// Slow looping orbit on a slice of the background stars (index 53).
  double bgDrift = 1.00;

  /// How much of the sky the gas covers (shader index 54), independent of how
  /// bright it is.
  double gasSpread = 0.20;

  /// Accent hue strength for the gas (shader index 55).
  double gasHue = 0.50;

  /// Galaxy cloud-texture spin relative to the arms (shader index 56).
  /// 0.5 = locked, 1.0 = 5x the arms, 0.0 = 0.5x BACKWARDS. 0.4833
  /// reproduces the constant 5% lag this shader always had.
  double cloudSpin = 0.4833;

  /// Tilt the dive lands on, in DEGREES. Lives here rather than in the
  /// uniform table because the easing is computed on the CPU -- the shader
  /// only ever sees the resulting uCamTilt for the current frame.
  double diveTiltDeg = 30.0;

  /// 1.0 = live. Below that, freeze the render at this dive depth so cost
  /// can be ablated at a fixed zoom instead of a moving target.
  double zoomPin = 1.0;
  double starDensity = _GalaxyDotDefaults.starDensity;
  bool armSmoke = true;
  bool gasClouds = true;
  bool coreGlow = true;
  bool bulge = true;
  bool flare = true;
  bool armWobble = true;

  void reset() {
    renderScale = 0.5;
    flatFloaters = 1.7;
    floaterDensity = 30.0;
    floaterSize = 1.0;
    floaterSpread = 1.5;
    maxStarLod = _GalaxyDotDefaults.maxStarLod;
    flareStart = 0.25;
    bgCount = 0.24;
    bgSize = 0.15;
    nebula = 0.60;
    bgDrift = 1.00;
    gasSpread = 0.20;
    gasHue = 0.50;
    cloudSpin = 0.4833;
    diveTiltDeg = 30.0;
    zoomPin = 1.0;
    starDensity = _GalaxyDotDefaults.starDensity;
    armSmoke = gasClouds = coreGlow = bulge = flare = armWobble = true;
  }

  /// Named starting points. The old pane presets went with uDiskThickness --
  /// this build has no height sheets, so depth is floaters or nothing.
  void preset(String name) {
    reset();
    switch (name) {
      case 'Flat':
        flatFloaters = 0.0; // no off-plane layer at all
      case 'Flat + floaters':
        break; // the defaults already are this
      case 'Everything off':
        flatFloaters = 0.0;
        starDensity = 0.0;
        armSmoke = gasClouds = coreGlow = bulge = flare = armWobble = false;
    }
  }

  /// Indices match the verified uniform table in [GalaxyDotPainter].
  Map<int, double> get overrides => {
    13: armWobble ? _GalaxyDotDefaults.armWobble : 0.0,
    14: armSmoke ? _GalaxyDotDefaults.armSmoke : 0.0,
    16: coreGlow ? _GalaxyDotDefaults.coreGlow : 0.0,
    18: bulge ? _GalaxyDotDefaults.bulge : 0.0,
    19: flare ? _GalaxyDotDefaults.flare : 0.0,
    21: gasClouds ? _GalaxyDotDefaults.gasClouds : 0.0,
    25: starDensity,
    26: maxStarLod,
    45: flatFloaters,
    46: floaterDensity,
    47: floaterSize,
    48: floaterSpread,
    49: flareStart,
    50: bgCount,
    51: bgSize,
    52: nebula,
    53: bgDrift,
    54: gasSpread,
    55: gasHue,
    56: cloudSpin,
  };
}

class GalaxyDotPainter extends CustomPainter {
  GalaxyDotPainter({
    required this.shader,
    required this.driver,
    required this.dpr,
    this.overrides = const {},
    this.renderScale = 1.0,
    this.zoomPin = 1.0,
    this.liftLogicalPx = 64.0,
  });

  /// How far up the screen the galaxy sits, in LOGICAL pixels. Converted to
  /// p units here rather than in the shader: the dpr cancels out of
  /// 2 * lift * dpr / (height * dpr), so this is exact on any device and at
  /// any render scale, which a pixel constant in the shader could not be.
  final double liftLogicalPx;

  final ui.FragmentShader shader;
  final GalaxyDotDriver driver;
  final double dpr;

  /// < 1.0 freezes the render at that dive depth instead of following the
  /// driver, so cost can be measured at a fixed, reproducible zoom. Dive
  /// timing jitter otherwise makes mid-dive A/B comparisons meaningless.
  final double zoomPin;

  /// Uniform-index overrides applied last, for ablation measurement.
  final Map<int, double> overrides;

  /// 1.0 = native device resolution. Below that the shader is run into a
  /// smaller offscreen image and blitted up, cutting fragment count by the
  /// square of this factor.
  final double renderScale;

  @override
  void paint(Canvas canvas, Size size) {
    final physW = size.width * dpr;
    final physH = size.height * dpr;

    if (renderScale >= 0.999) {
      // Native path: draw straight into the frame.
      // iResolution must match the space FlutterFragCoord() reports in, which
      // in Flutter is LOGICAL pixels — not the physical pixels the reference
      // doc assumes (see bug 8.2). Normalised coords are identical either way.
      _bind(size.width, size.height, driver.pxSizeAt(_z, physW, physH),
          2.0 * liftLogicalPx / size.height);
      canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
      return;
    }

    // Reduced-resolution path. Flutter has no implicit render-scale — a
    // Transform still rasterises the layer at device resolution — so the
    // shader has to be run into its own image at the smaller pixel size.
    // Inside toImageSync the picture rasterises 1 device pixel per picture
    // unit, so iResolution is the render size itself, and uPxSize must use
    // that same grid or the stars will alias.
    final rw = (physW * renderScale).roundToDouble().clamp(1.0, physW);
    final rh = (physH * renderScale).roundToDouble().clamp(1.0, physH);
    _bind(rw, rh, driver.pxSizeAt(_z, rw, rh),
        2.0 * liftLogicalPx / size.height);

    final recorder = ui.PictureRecorder();
    Canvas(
      recorder,
    ).drawRect(Rect.fromLTWH(0, 0, rw, rh), Paint()..shader = shader);
    final picture = recorder.endRecording();
    final image = picture.toImageSync(rw.toInt(), rh.toInt());
    canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, rw, rh),
      Offset.zero & size,
      Paint()..filterQuality = FilterQuality.medium,
    );
    // Both are GPU-resident and recreated every frame; leaking them would
    // exhaust video memory within seconds at 60fps.
    image.dispose();
    picture.dispose();
  }

  /// Effective zoom: the pin when set, otherwise whatever the dive driver is
  /// doing. uZoom, uCamTilt and uPxSize must all agree on it.
  double get _z => zoomPin < 0.999 ? zoomPin : driver.zoom;

  void _bind(double w, double h, double px, double liftY) {
    int i = 0;
    void f(double v) => shader.setFloat(i++, v);

    f(w); // 0  iResolution.x
    f(h); // 1  iResolution.y
    f(driver.shaderTime); // 2  iTime (rotation clock, NOT wall time)
    f(_z); // 3  (zoomPin freezes this for measurement)
    f(driver.fade); // 4
    f(_GalaxyDotDefaults.rotSpeed); // 5
    f(_GalaxyDotDefaults.armCount); // 6
    f(_GalaxyDotDefaults.armWinding); // 7
    f(_GalaxyDotDefaults.armSpacing); // 8
    f(_GalaxyDotDefaults.armFalloff); // 9
    f(_GalaxyDotDefaults.armSpread); // 10
    f(_GalaxyDotDefaults.armEdgeSkew); // 11
    f(_GalaxyDotDefaults.rimCoarse); // 12
    f(_GalaxyDotDefaults.armWobble); // 13
    f(_GalaxyDotDefaults.armSmoke); // 14
    f(_GalaxyDotDefaults.smokeSkew); // 15
    f(_GalaxyDotDefaults.coreGlow); // 16
    f(_GalaxyDotDefaults.coreGlowSpread); // 17
    f(_GalaxyDotDefaults.bulge); // 18
    f(_GalaxyDotDefaults.flare); // 19
    f(driver.hazePulse); // 20
    f(_GalaxyDotDefaults.gasClouds); // 21
    f(_GalaxyDotDefaults.ovalness); // 22
    f(driver.tiltAt(_z)); // 23 uCamTilt — matches the effective zoom
    f(_GalaxyDotDefaults.compactness); // 24
    f(_GalaxyDotDefaults.starDensity); // 25
    f(_GalaxyDotDefaults.maxStarLod); // 26
    f(_GalaxyDotDefaults.twinkleFraction); // 27
    f(_GalaxyDotDefaults.twinkleSpeed); // 28
    f(driver.twinkleTime); // 29 wall clock
    f(px); // 30
    f(_GalaxyDotDefaults.blackHoleSize); // 31
    for (final c in _GalaxyDotDefaults.centerColor) {
      f(c); // 32-35
    }
    for (final c in _GalaxyDotDefaults.armColor) {
      f(c); // 35-38
    }
    for (final c in _GalaxyDotDefaults.hazeColor) {
      f(c); // 38-41
    }
    for (final c in _GalaxyDotDefaults.starColor) {
      f(c); // 41-44
    }
    f(_GalaxyDotDefaults.centerSpread); // 44
    f(0.0); // 45 uFlatFloaters — off by default; the tuning overrides raise it
    f(5.0); // 46 uFloaterDensity — upstream default; overrides raise it
    f(1.0); // 47 uFloaterSize — 1.0 = default; overrides change it
    f(1.1); // 48 uFloaterSpread — 1.0 = bulge reach; 1.1 ~10% wider
    f(0.25); // 49 uFlareStart — overridden below; kept in step with it
    f(0.24); // 50 uBgCount — how many background stars
    f(0.15); // 51 uBgSize  — how big, floored at 2 rendered px
    f(0.60); // 52 uNebula  — faint background gas; 0 skips it entirely
    f(1.00); // 53 uBgDrift — slow looping orbit on some background stars
    f(0.20); // 54 uGasSpread — how much of the sky the gas covers
    f(0.50); // 55 uGasHue — teal/rose accent strength
    f(0.4833); // 56 uCloudSpin — cloud texture vs arms; 0.5 = locked
    // 57-60 uGasRotA/B: the background gas rotates its two noise octaves in
    // opposite senses. Both angles are time-only, so the trig belongs here,
    // once a frame, not in the fragment shader 648k times.
    const gasRateA = 0.055, gasRateB = -0.092;
    final angA = driver.twinkleTime * gasRateA;
    final angB = driver.twinkleTime * gasRateB;
    f(math.cos(angA)); // 57
    f(math.sin(angA)); // 58
    f(math.cos(angB)); // 59
    f(math.sin(angB)); // 60
    f(liftY); // 61 uLiftY — galaxy lift, in p units

    // Applied last so they win over the defaults written above.
    overrides.forEach(shader.setFloat);
  }

  @override
  bool shouldRepaint(covariant GalaxyDotPainter oldDelegate) => true;
}

/// Render-scale ladder, shared by the tuning sheet and the sprite controls
/// so the two cannot drift apart.
const List<double> kRenderScales = [1.0, 0.85, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

class GalaxyView extends StatefulWidget {
  const GalaxyView({super.key});
  @override
  State<GalaxyView> createState() => _GalaxyViewState();
}

class _GalaxyViewState extends State<GalaxyView>
    with SingleTickerProviderStateMixin {
  ui.FragmentShader? _dotShader;
  final GalaxyDotDriver _dotDriver = GalaxyDotDriver();

  /// Live tuning for the advanced shader; only meaningful while it runs.
  final _Tuning _tuning = _Tuning();

  void _openTuning() {
    showModalBottomSheet<void>(
      context: context,
      // Transparent barrier so the galaxy stays fully visible and readable
      // while values are being dragged.
      barrierColor: Colors.transparent,
      backgroundColor: const Color(0xF014161A),
      isScrollControlled: true,
      // Without a drag handle the SingleChildScrollView below consumes the
      // downward drag, so the sheet could only be dismissed with Back.
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) =>
          _TuningSheet(tuning: _tuning, onChanged: () => setState(() {})),
    );
  }

  /// All animation state lives in the driver; the view only keeps the clock.
  Duration _lastTick = Duration.zero;
  late final Ticker _ticker;

  @override
  void initState() {
    super.initState();
    _loadShader();
    _ticker = createTicker(_onTick)..start();
  }

  Future<void> _loadShader() async {
    final program = await ui.FragmentProgram.fromAsset(
      'shaders/galaxy_floater.frag',
    );
    if (!mounted) return;
    setState(() => _dotShader = program.fragmentShader());
  }

  void _onTick(Duration elapsedTotal) {
    _dotDriver.diveFloorRad = _tuning.diveTiltDeg * math.pi / 180.0;
    final delta = (elapsedTotal - _lastTick).inMicroseconds / 1e6;
    _lastTick = elapsedTotal;
    _dotDriver.tick(delta);
    if (mounted) setState(() {});
  }

  /// Starts the dive, or pauses/resumes one already running so a frame can
  /// be inspected mid-plunge.
  void _triggerBoom() {
    setState(_dotDriver.diving ? _dotDriver.togglePause : _dotDriver.startDive);
  }

  bool get _busy => _dotDriver.diving;

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_dotShader == null) {
      return const Center(
        child: CircularProgressIndicator(color: Colors.white24),
      );
    }
    // Shader is the full-bleed background layer ("wallpaper"); regular
    // Flutter UI stacks on top of it.
    return Stack(
      children: [
        Positioned.fill(
          child: RepaintBoundary(
            child: CustomPaint(
              painter: GalaxyDotPainter(
                shader: _dotShader!,
                driver: _dotDriver,
                dpr: MediaQuery.devicePixelRatioOf(context),
                overrides: _tuning.overrides,
                renderScale: _tuning.renderScale,
                zoomPin: _tuning.zoomPin,
              ),
              size: Size.infinite,
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _Controls(
            tuning: _tuning,
            onTuningChanged: () => setState(() {}),
            busy: _busy,
            paused: _dotDriver.paused,
            onBoom: _triggerBoom,
            onOpenTuning: _openTuning,
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          child: _StatsOverlay(
            // Self-documenting: every screenshot then records exactly which
            // config produced the numbers, instead of relying on remembering
            // which chips were tapped.
          ),
        ),
      ],
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.busy,
    required this.paused,
    required this.onBoom,
    required this.onOpenTuning,
    required this.tuning,
    required this.onTuningChanged,
  });

  final bool busy;
  final bool paused;
  final VoidCallback onBoom;
  final VoidCallback onOpenTuning;

  /// TEMPORARY: dive-end tilt, on the main screen rather than in the sheet so
  /// it can be swept during a paused dive without the sheet covering the
  /// galaxy. Move it into the sheet or hard-code the value once it is settled.
  final _Tuning tuning;
  final VoidCallback onTuningChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.transparent, Colors.black.withValues(alpha: 0.75)],
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // TEMPORARY dive-end tilt.
              Row(
                children: [
                  SizedBox(
                    width: 108,
                    child: Text(
                      'End tilt ${tuning.diveTiltDeg.round()}°',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Expanded(
                    child: SliderTheme(
                      data: SliderThemeData(
                        trackHeight: 2,
                        activeTrackColor: Colors.white,
                        inactiveTrackColor: Colors.white24,
                        thumbColor: Colors.white,
                        overlayColor: Colors.white24,
                        thumbShape: const RoundSliderThumbShape(
                          enabledThumbRadius: 7,
                        ),
                      ),
                      child: Slider(
                        value: tuning.diveTiltDeg,
                        min: 10,
                        max: 72,
                        divisions: 62,
                        onChanged: (v) {
                          tuning.diveTiltDeg = v;
                          onTuningChanged();
                        },
                      ),
                    ),
                  ),
                ],
              ),
              // Opens the grouped tuning sheet.
              Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: onOpenTuning,
                      icon: const Icon(Icons.tune, size: 18),
                      label: const Text(
                        'Tune shader',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: BorderSide(
                          color: Colors.white.withValues(alpha: 0.35),
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              // Main animated-transition button.
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onBoom,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF007BFF),
                    disabledBackgroundColor: Colors.white12,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(
                    !busy
                        ? 'Dive'
                        : paused
                        ? 'Resume'
                        : 'Pause',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Always-on perf HUD: FPS, UI/raster (CPU/GPU proxy) frame times, resident
/// so the cost of the shader is visible at a glance. Memory and battery
/// used to sit here too; neither moved with anything we tune, and polling
/// the battery once a second put platform-channel work on the UI thread
/// that showed up in the very number it was sitting next to.
///
/// "CPU"/"GPU" here are Flutter's own build/raster frame times, not
/// system-wide core usage: Dart has no cross-platform API for true per-app
/// CPU%, and GPU%is not exposed by any platform at all. Raster time is the
/// accurate proxy for GPU load anyway, since it's time this shader spends
/// executing on the GPU each frame.
class _StatsOverlay extends StatefulWidget {
  const _StatsOverlay();

  @override
  State<_StatsOverlay> createState() => _StatsOverlayState();
}

enum _Load { low, medium, heavy }

class _StatsOverlayState extends State<_StatsOverlay> {
  double _fps = 0;
  double _buildMs = 0;
  double _rasterMs = 0;
  double _budgetMs = 1000 / 60;

  // Last few windows' results. One window is one second, and a single second
  // is a bad unit of judgement here: the window that catches the tail of a
  // dive is mostly dive frames, so the badge would spike to ~90% once and
  // drop straight back with nothing wrong. Median of three rides that out
  // while still reacting inside a few seconds to a real change.

  double _loadRatio = 0;
  bool _saturated = false;

  _Load _load = _Load.low;

  Timer? _statsTimer;

  /// This device's display refresh rate — the frame budget to judge against.
  double get _refreshRate {
    final views = ui.PlatformDispatcher.instance.views;
    if (views.isEmpty) return 60.0;
    final rate = views.first.display.refreshRate;
    return rate > 0 ? rate : 60.0;
  }

  // Rolling accumulation between the once-a-second refreshes.
  int _frameCount = 0;
  double _buildAccumMs = 0;
  double _rasterAccumMs = 0;

  @override
  void initState() {
    super.initState();
    SchedulerBinding.instance.addTimingsCallback(_onFrameTimings);

    _statsTimer = Timer.periodic(const Duration(seconds: 1), (_) => _refresh());
  }

  void _onFrameTimings(List<FrameTiming> timings) {
    for (final t in timings) {
      _frameCount++;
      _buildAccumMs += t.buildDuration.inMicroseconds / 1000;
      _rasterAccumMs += t.rasterDuration.inMicroseconds / 1000;
    }
  }

  void _refresh() {
    setState(() {
      if (_frameCount > 0) {
        _fps = _frameCount.toDouble(); // frames presented in the last ~1s
        _buildMs = _buildAccumMs / _frameCount;
        _rasterMs = _rasterAccumMs / _frameCount;
      }
      _frameCount = 0;
      _buildAccumMs = 0;
      _rasterAccumMs = 0;

      // rasterDuration measures real work ONLY while the work exceeds the
      // frame interval. Under that, the raster thread finishes early and
      // blocks waiting for a buffer, so the number saturates at one interval
      // and stops meaning anything. Measured both sides on this device with
      // the same shader: at renderScale 1.0 it reads 28.0ms / 37fps (true --
      // 37fps proves it), and at 0.5 it reads 16.0ms / 62fps (saturated --
      // switching the gas and the entire background starfield off changed it
      // by 1.0ms). The old app looked perfectly reliable because it ran at
      // native resolution, permanently above that line.
      //
      // So the only honest move is to say which side of the line we are on.
      // Full cadence means the frame fits, whatever the raster number says,
      // and the ratio is then an upper bound rather than a reading.
      _budgetMs = 1000 / _refreshRate;
      _loadRatio = math.max(_buildMs, _rasterMs) / _budgetMs;
      _saturated = _fps >= _refreshRate * 0.95 && _rasterMs > _budgetMs * 0.9;
      if (_saturated || _loadRatio <= 0.6) {
        _load = _Load.low;
      } else if (_loadRatio <= 1.0) {
        _load = _Load.medium;
      } else {
        _load = _Load.heavy;
      }
    });
  }

  @override
  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_onFrameTimings);
    _statsTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.black.withValues(alpha: 0.75), Colors.transparent],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _loadBadge(),
              const SizedBox(height: 6),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 14,
                runSpacing: 4,
                children: [
                  _stat('FPS', _fps.toStringAsFixed(0)),
                  _stat('UI', '${_buildMs.toStringAsFixed(1)}ms'),
                  // Reported ONLY when the number means something. Flutter
                  // gives raster wall time, which includes waiting for a free
                  // buffer, and no Android API exposes true per-frame GPU
                  // time. The 20th percentile recovers the real cost when at
                  // least some frames skipped the queue -- but when every
                  // frame in the window blocked, the percentile is just the
                  // vsync interval wearing a GPU label, and the same 3ms
                  // content reads as 15ms. In that case we do not know, and
                  // saying so beats printing a confident wrong number.
                  _stat('Raster', '${_rasterMs.toStringAsFixed(1)}ms'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _loadBadge() {
    final (color, label, emoji) = switch (_load) {
      _Load.low => (const Color(0xFF34C759), 'Low', '🟢'),
      _Load.medium => (const Color(0xFFFFCC00), 'Medium', '🟡'),
      _Load.heavy => (const Color(0xFFFF3B30), 'Heavy', '🔴'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(emoji, style: const TextStyle(fontSize: 12)),
          const SizedBox(width: 6),
          Text(
            '$label load · ${(_loadRatio * 100).round()}% of frame budget',
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(
          fontSize: 12,
          fontFeatures: [ui.FontFeature.tabularFigures()],
        ),
        children: [
          TextSpan(
            text: '$label ',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.55)),
          ),
          TextSpan(
            text: value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Grouped, direct-manipulation tuning panel for the advanced shader.
///
/// Replaces the earlier linear ablation stepper: every knob is reachable in
/// one tap/drag instead of cycling through 21 states, and changes apply live
/// so the perf HUD at the top of the screen can be read while dragging.
class _TuningSheet extends StatefulWidget {
  const _TuningSheet({required this.tuning, required this.onChanged});

  final _Tuning tuning;

  /// Called after every mutation so the host can repaint with new uniforms.
  final VoidCallback onChanged;

  @override
  State<_TuningSheet> createState() => _TuningSheetState();
}

class _TuningSheetState extends State<_TuningSheet> {
  static const _presets = <String>[
    'Flat',
    'Flat + floaters',
    'Everything off',
  ];

  _Tuning get t => widget.tuning;

  /// Mutate, refresh this sheet, and repaint the shader behind it.
  void _edit(VoidCallback change) {
    setState(change);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    // The app itself runs the default LIGHT Material theme, so without this
    // the chips resolve to light surfaces and their white labels vanish.
    return Theme(
      data: ThemeData.dark(useMaterial3: true).copyWith(
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF007BFF),
          surface: Color(0xFF14161A),
        ),
      ),
      child: SafeArea(
        top: false,
        // The panel is taller than the screen on this device, so it has to
        // scroll — otherwise the Features row is simply unreachable.
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.85,
          ),
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        'Tune shader',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () => _edit(t.reset),
                        child: const Text('Reset'),
                      ),
                    ],
                  ),
                  _label('Presets'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final p in _presets)
                        ActionChip(
                          label: Text(p),
                          onPressed: () => _edit(() => t.preset(p)),
                          backgroundColor: Colors.white10,
                          labelStyle: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                          ),
                          side: BorderSide(
                            color: Colors.white.withValues(alpha: 0.25),
                          ),
                        ),
                    ],
                  ),
                  _label('Render scale'),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final s in kRenderScales)
                        ChoiceChip(
                          label: Text(
                            s == 1.0
                                ? 'Native'
                                : '${(1080 * s).round()}x${(2400 * s).round()}',
                          ),
                          selected: (t.renderScale - s).abs() < 0.001,
                          onSelected: (_) => _edit(() => t.renderScale = s),
                          backgroundColor: Colors.white10,
                          selectedColor: const Color(0xFF007BFF),
                          labelStyle: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                          ),
                          side: BorderSide(
                            color: Colors.white.withValues(alpha: 0.25),
                          ),
                        ),
                    ],
                  ),
                  _slider(
                    'Background count',
                    t.bgCount,
                    0,
                    1,
                    25,
                    (v) => _edit(() => t.bgCount = v),
                    hint: t.bgCount < 0.001 ? 'none' : null,
                  ),
                  _slider(
                    'Background size',
                    t.bgSize,
                    0,
                    1,
                    20,
                    (v) => _edit(() => t.bgSize = v),
                  ),
                  _slider(
                    'Gas brightness',
                    t.nebula,
                    0,
                    1,
                    20,
                    (v) => _edit(() => t.nebula = v),
                    hint: t.nebula < 0.001 ? 'off' : null,
                  ),
                  _slider(
                    'Gas spread',
                    t.gasSpread,
                    0,
                    1,
                    20,
                    (v) => _edit(() => t.gasSpread = v),
                    hint: t.gasSpread < 0.001 ? 'banks' : null,
                  ),
                  _slider(
                    'Gas hue',
                    t.gasHue,
                    0,
                    1,
                    20,
                    (v) => _edit(() => t.gasHue = v),
                    hint: t.gasHue < 0.001 ? 'plain' : null,
                  ),
                  _slider(
                    'Cloud spin',
                    t.cloudSpin,
                    0,
                    1,
                    24,
                    (v) => _edit(() => t.cloudSpin = v),
                    hint: (t.cloudSpin - 0.5).abs() < 0.011
                        ? 'locked'
                        : t.cloudSpin < 0.167
                        ? 'reverse'
                        : null,
                  ),
                  _slider(
                    'Background drift',
                    t.bgDrift,
                    0,
                    1,
                    20,
                    (v) => _edit(() => t.bgDrift = v),
                    hint: t.bgDrift < 0.001 ? 'still' : null,
                  ),
                  _slider(
                    'Max star refill',
                    t.maxStarLod,
                    0,
                    3,
                    30,
                    (v) => _edit(() => t.maxStarLod = v),
                    hint: t.maxStarLod < 0.05
                        ? 'no refill — pure magnify'
                        : null,
                  ),
                  _slider(
                    'Flares start at depth',
                    t.flareStart,
                    0.05,
                    0.6,
                    22,
                    (v) => _edit(() => t.flareStart = v),
                    hint: t.flareStart >= 0.58
                        ? 'earliest'
                        : t.flareStart <= 0.06
                        ? 'latest'
                        : null,
                  ),
                  _slider(
                    'Zoom pin (dive depth)',
                    t.zoomPin,
                    0.05,
                    1,
                    19,
                    (v) => _edit(() => t.zoomPin = v),
                    hint: t.zoomPin >= 0.999 ? 'live' : null,
                  ),
                  _slider(
                    'Floater height',
                    t.flatFloaters,
                    0,
                    3,
                    30,
                    (v) => _edit(() => t.flatFloaters = v),
                    hint: t.flatFloaters < 0.001 ? 'off' : null,
                  ),
                  _slider(
                    'Floater count',
                    t.floaterDensity,
                    2,
                    30,
                    28,
                    (v) => _edit(() => t.floaterDensity = v),
                    enabled: t.flatFloaters > 0.001,
                    hint: t.flatFloaters > 0.001 ? null : 'set a height first',
                  ),
                  _slider(
                    'Floater size',
                    t.floaterSize,
                    0.25,
                    4,
                    30,
                    (v) => _edit(() => t.floaterSize = v),
                    enabled: t.flatFloaters > 0.001,
                    hint: t.flatFloaters > 0.001 ? null : 'set a height first',
                  ),
                  _slider(
                    'Floater spread',
                    t.floaterSpread,
                    0.5,
                    2,
                    30,
                    (v) => _edit(() => t.floaterSpread = v),
                    enabled: t.flatFloaters > 0.001,
                    hint: t.flatFloaters > 0.001 ? null : 'set a height first',
                  ),
                  _slider(
                    'Star density',
                    t.starDensity,
                    0,
                    12,
                    48,
                    (v) => _edit(() => t.starDensity = v),
                  ),
                  _label('Features'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _flag(
                        'Arm smoke',
                        t.armSmoke,
                        (v) => _edit(() => t.armSmoke = v),
                      ),
                      _flag(
                        'Gas clouds',
                        t.gasClouds,
                        (v) => _edit(() => t.gasClouds = v),
                      ),
                      _flag(
                        'Core glow',
                        t.coreGlow,
                        (v) => _edit(() => t.coreGlow = v),
                      ),
                      _flag('Bulge', t.bulge, (v) => _edit(() => t.bulge = v)),
                      _flag('Flare', t.flare, (v) => _edit(() => t.flare = v)),
                      _flag(
                        'Arm wobble',
                        t.armWobble,
                        (v) => _edit(() => t.armWobble = v),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Text(
      text.toUpperCase(),
      style: TextStyle(
        color: Colors.white.withValues(alpha: 0.5),
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.8,
      ),
    ),
  );

  Widget _flag(String name, bool value, ValueChanged<bool> onChanged) =>
      FilterChip(
        label: Text(name),
        selected: value,
        onSelected: onChanged,
        backgroundColor: Colors.white10,
        selectedColor: const Color(0xFF007BFF),
        checkmarkColor: Colors.white,
        labelStyle: const TextStyle(color: Colors.white, fontSize: 12),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.25)),
      );

  Widget _slider(
    String name,
    double value,
    double min,
    double max,
    int divisions,
    ValueChanged<double> onChanged, {
    String? hint,
    bool enabled = true,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                name,
                style: TextStyle(
                  color: enabled ? Colors.white70 : Colors.white24,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              Text(
                hint ?? value.toStringAsFixed(2),
                style: TextStyle(
                  color: !enabled
                      ? Colors.white24
                      : hint != null
                      ? const Color(0xFF34C759)
                      : Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  fontFeatures: const [ui.FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              trackHeight: 3,
              overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
            ),
            child: Slider(
              value: value.clamp(min, max),
              min: min,
              max: max,
              divisions: divisions,
              activeColor: enabled ? const Color(0xFF007BFF) : Colors.white24,
              inactiveColor: Colors.white12,
              // Null disables the control outright, so the dependency on
              // Floater height is visible rather than something to remember.
              onChanged: enabled ? onChanged : null,
            ),
          ),
        ],
      ),
    );
  }
}
