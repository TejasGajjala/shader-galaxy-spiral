// PRODUCTION build. Includes the background nebula gas, drawn on the top
// two quality tiers only (uNebula = 0 elsewhere skips it). 62-float layout.
//
// Flutter FragmentProgram port of the spiral-galaxy shader -- FLOATER
// build: a production-lean variant of galaxy.frag.
//
// Differences from galaxy.frag:
//   * The volumetric height-sheet disk (uDiskThickness and its N-sheet
//     loop) is REMOVED. That path measured ~72% of the frame on an
//     Adreno 660 and is the single biggest cost in the original.
//   * Depth instead comes from an off-plane FLOATER layer on the flat
//     disk: one coarse, correctly parallaxed sheet of stars above the
//     plane (uFlatFloaters/Density/Size/Spread, indices 45-48).
//   * Because the sheet machinery is gone, the per-star sheet partition
//     (partLo/partHi) and residual height shift are gone from the star
//     lattice too.
// Net: same look at rest minus the volumetric loft, roughly half the
// compiled size, and it holds 60fps where the original could not.
// Arm/dust/disk math adapted from S.Guillitte's galaxy shader
// (CC BY-NC-SA 3.0).
//
// Register under `shaders:` in pubspec.yaml and drive it per
// FLUTTER_IMPLEMENTATION.md -- uniforms are set BY FLOAT INDEX in the
// declaration order below (vec2 = 2 slots, vec3 = 3); the full index
// table and the dive choreography live in that doc.
#version 460 core
#include <flutter/runtime_effect.glsl>

uniform vec2 iResolution;       // canvas size in physical pixels
uniform float iTime;            // rotation clock (dive-accelerated; NOT wall time)

uniform float uZoom;
uniform float uFade;
uniform float uRotSpeed;

// Sandbox controls
uniform float uArmCount;
uniform float uArmWinding;
uniform float uArmSpacing;      // radial spacing between arm turns without
                                // changing how many there are; see spacingWarp().
                                // >1 opens the center, <1 opens the rim. 1.0 = original.
uniform float uArmFalloff;      // outward DENSITY falloff of the arm star
                                // population: with radius fewer stars are
                                // kept (per-star presence roll, survivors
                                // stay full brightness -- never dimmed).
                                // 0 = uniform density, bit-identical.
uniform float uArmSpread;       // outward WIDTH of the arm star band: the
                                // angular cross-section fattens with
                                // radius (armProfile) and partly
                                // dissolves toward an isotropic scatter
                                // (armDissolve), so the outer arms lose
                                // the string-like shape. STARS ONLY --
                                // the smoke arms keep their fixed width.
                                // 0 = old fixed-width arms, bit-identical.
uniform float uArmEdgeSkew;     // one-sided arm falloff: hard, sharply
                                // defined INNER edge and a soft feathered
                                // OUTER edge (density-wave shock front vs
                                // trailing material). Reshapes the flanks
                                // only -- crest brightness is unchanged
                                // and nothing clips. STARS ONLY.
                                // 0 = symmetric arms, bit-identical.
uniform float uRimCoarse;       // rim coarseness: extra thinning of the
                                // OUTERMOST star band (past r = 1.0) so
                                // the last stars sit further apart and
                                // read as separated points rather than
                                // fine grain. Presence roll only --
                                // survivors keep their exact size and
                                // brightness, nothing is inflated.
                                // 0 = old rim density, bit-identical.
uniform float uArmWobble;       // organic imperfection: a static noise
                                // warp on the arm PHASE, baked into the
                                // rotating pattern frame, so the windings
                                // wander instead of tracing a perfect log
                                // spiral. Applied to stars AND smoke from
                                // the same field, so they stay registered.
                                // Grows with radius: tight inner coil,
                                // wandering outer arms. 0 = perfect
                                // spiral, bit-identical.
// --- Nebula haze, split into independently-scaled components (each is
// amount x hazeMod x its own shape; 0 = that piece hidden). Stars are
// separate. The old single uHaze == all of these at the same value.
// (A fourth component, the soft secondary glow layer, was removed.)
uniform float uArmSmoke;        // smoky filaments tracing the spiral arms
uniform float uSmokeSkew;       // one-sided falloff for the SMOKE arms:
                                // the same hard-inner/feathered-outer
                                // flank trade as uArmEdgeSkew, minus the
                                // width plateau (smoke keeps its fixed
                                // width on purpose). Lets gas and stars
                                // agree on which side is the shock front.
                                // 0 = symmetric smoke, bit-identical.
uniform float uCoreGlow;        // broad bright haze at the nucleus
uniform float uCoreGlowSpread;  // radial REACH of the core glow with the
                                // center intensity pinned (gaussian width
                                // scale; the peak of a gaussian is
                                // independent of its width). 1.0 = the
                                // original shape, <1 hugs the core,
                                // >1 extends outward.
uniform float uBulge;           // stellar bulge strength; 0 = arms only
                                // >0 lifts stars off the plane: the main
                                // field gets a sub-cell hashed height
                                // scatter (fuzzy slab rim), plus a sparse
                                // coarse lattice of real floaters that
                                // slide with parallax during the dive.
uniform float uFlare;           // 4-point diffraction spikes + soft bloom.
                                // Alive ONLY in the dive's final stretch
                                // (uZoom < 0.22, full by 0.07), on ALL
                                // stars -- small crosses on the swarm,
                                // big ones on the floaters. At rest and
                                // mid-dive every star is a plain dot.
uniform float uHazePulse;       // dive-start "come alive" beat, driven by
                                // the host: the nebula dims and swells
                                // back just before the zoom. 1.0 = neutral
                                // (rest state and everywhere else).
uniform float uGasClouds;       // gauzy fog banks floating OVER the disk,
                                // scattered at random (not arm-masked), so
                                // they read in the dark winding gaps where
                                // nothing competes with them. Own rotation
                                // frame slightly slower than the spiral =
                                // visible relative drift. 0 = off.
uniform float uOvalness;        // intrinsic elongation (Sa/Sb); see the
                                // ovalness frames built in mainImage.
                                // 1.0 = round (original).
uniform float uCamTilt;         // camera tilt off top-down, radians (0 =
                                 // straight overhead/flat; larger = more
                                 // oblique). Replaces a uniform vertical
                                 // squash with a real perspective plane
                                 // projection -- near side (screen bottom)
                                 // spreads out, far side (screen top)
                                 // compresses toward a horizon, instead of
                                 // uniformly scaling like a stretched image.
uniform float uCompactness;
uniform float uStarDensity;
uniform float uMaxStarLod;      // caps starField() grid refill during the
                                // dive; past this many doublings the
                                // field stops refining, so stars grow and
                                // spread instead of refilling forever
uniform float uTwinkleFraction; // 0..1: fraction of stars that twinkle
uniform float uTwinkleSpeed;    // pulse rate, independent of rotation
uniform float uTwinkleTime;     // wall-clock time (not the scaled iTime)
uniform float uPxSize;          // p-space size of one screen pixel (anti-alias)
uniform float uBlackHoleSize;
// Palette. Four roles driving an exact decomposition of the original
// grayscale formula: with all four left at the same neutral gray the
// output is bit-identical to the old single-tint look, and editing one
// recolors only that element (arms / center / haze / stars).
uniform vec3 uNormalCenterColor;
uniform vec3 uNormalArmColor;
uniform vec3 uNormalHazeColor;
uniform vec3 uNormalStarColor;
uniform float uCenterSpread;    // how far the center tint reaches (gaussian)

// LOCAL ADDITION (index 46, appended so no existing index shifts).
// Off-plane floater height for the FLAT disk path. 0 = upstream behaviour,
// bit for bit. Above 0 it lends the flat disk the same sparse, correctly
// parallaxed off-plane stars the thick path gets -- the cheap 3D cue,
// without paying for the height-sheet lattice passes.
uniform float uFlatFloaters;

// LOCAL ADDITION (index 47, appended). Floater lattice density for the flat
// path. Upstream hardcoded 5.0. Raising it packs MORE floater stars over the
// disk at ~no extra cost: the lookup always walks the same 9 cells, a finer
// grid just puts more stars inside them.
uniform float uFloaterDensity;

// LOCAL ADDITION (index 48, appended). Overall floater star size, 1.0 =
// default. Lets the size be dialled on-device instead of rebuilt.
uniform float uFloaterSize;

// LOCAL ADDITION (index 49, appended). Floater reach, as a RADIUS multiplier
// on the bulge's own gaussian: 1.0 spreads exactly like the bulge stars,
// 1.1 reaches ~10% further out. Replaces the old slow exp(-r * 1.1) falloff,
// which scattered floaters well outside the spiral.
uniform float uFloaterSpread;

// Dive depth at which diffraction flares begin. The ramp runs from here to
// uFlareStart * 0.32, holding the proportion the window was originally
// tuned at (0.22 -> 0.07). Appended last so every existing index is
// unchanged. The host now ships 0.17.
uniform float uFlareStart;

// Distant background stars. Two independent controls:
//   uBgCount - how many (0 = none at all)
//   uBgSize  - how big, in rendered pixels, never below the floor
uniform float uBgCount;
uniform float uBgSize;

// 52. Faint gas between the background stars. Dots on black read as a
//     starfield; what makes Shadertoy's deep-space shaders feel like SPACE
//     is a very soft colour field underneath them. 0 = off, and off is
//     genuinely skipped -- the noise is the only full-screen cost here.
uniform float uNebula;
// 53. Slow looping orbit on a slice of the background stars. Each mover
//     travels a closed circle, so the field never drifts anywhere; it just
//     never sits perfectly still either.
uniform float uBgDrift;
// 54. How much of the sky the gas covers, as opposed to how bright it is.
//     uNebula scales the final colour; this sets the floor the noise sits
//     on, so the two are genuinely separate knobs: spread decides whether
//     there is gas everywhere or only in banks, brightness decides how
//     strongly any of it shows.
uniform float uGasSpread;
// 55. Accent hue strength. 0 = the plain blue-violet wash; 1 = regions lean
//     teal or rose, the way real emission nebulae differ by what is glowing.
//     The regions come from noise already sampled, so this costs no taps.
uniform float uGasHue;
// 56. Spin of the galaxy's own cloud texture RELATIVE to the arms.
//     0.5 = locked to the arms. Below that the clouds trail (0 = 30%
//     slower), above it they run ahead (1 = 30% faster). Only the texture
//     inside the cloud bands is affected; the band centrelines stay locked
//     to the arms on purpose, or they migrate onto the windings.
uniform float uCloudSpin;
// 57-58, 59-60. cos/sin of the two background-gas rotation angles, computed
//     on the CPU once a frame. The angles depend only on time, so they are
//     identical for every pixel -- computing them in the shader meant the GPU
//     evaluating the same sin and cos 648k times a frame, measured at 0.7ms
//     of a native-resolution frame. Bound as values, they cost nothing.
uniform vec2 uGasRotA;
uniform vec2 uGasRotB;
// 63. Vertical lift of the galaxy in p units, computed on the CPU. It has to
//     come from there: the shader only knows the offscreen buffer size, and
//     a lift in LOGICAL pixels depends on the device pixel ratio and the
//     render scale, neither of which it can see.
uniform float uLiftY;

const mat2 m2 = mat2(0.8, 0.6, -0.6, 0.8);

float noise(in vec2 p) {
    float res = 0.0;
    for (int i = 0; i < 4; i++) {
        p = m2 * p * 2.0 + 0.6;
        res += sin(p.x + sin(2.0 * p.y));
    }
    return res / 4.0;
}

float fbmabs(vec2 p) {
    float f = 1.0;
    float r = 0.0;
    for (int i = 0; i < 8; i++) {
        r += abs(noise(p*f))/f;
        f *= 2.0;
        p -= vec2(-0.01, 0.08)*r;
    }
    return r;
}

float hash1(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Defined up here (not with the body helpers below) because the star
// fields need it too: flare crosses are drawn screen-aligned, so each
// star's delta gets un-rotated out of the spinning frame.
vec2 rotate(in vec2 p, in float t){
    return p * cos(-t) + vec2(p.y, -p.x) * sin(-t);
}

// Per-star twinkle: exactly uTwinkleFraction of stars pulse, each on its
// own phase of the wall-clock uTwinkleTime, so rotation/dive speed never
// affects the shimmer.
float starTwinkle(vec2 n) {
    // Uniform gate. At fraction 0 -- the production default -- the test
    // below can never pass (hash1 returns [0,1), so h > 1.0 is false), so
    // the hash was pure waste on every star-hit pixel. Coherent branch,
    // and exact: the function already returned 1.0 in that case.
    if (uTwinkleFraction < 0.001) return 1.0;
    float h = hash1(n + vec2(99.1, 23.7));
    if (h > 1.0 - uTwinkleFraction) {
        float pulse = abs(sin(uTwinkleTime * uTwinkleSpeed + h * 100.0));
        return mix(0.05, 3.0, pulse);
    }
    return 1.0;
}

// --- Shared flare kit -------------------------------------------------
// 4-point screen-aligned diffraction cross + soft bloom, per the
// reference's END-of-dive frames: crosses belong to the close-up swarm,
// so they only wake in the final stretch of the dive and every star is a
// clean dot at rest / mid-dive.
float flareRamp() {
    return smoothstep(uFlareStart, uFlareStart * 0.32, uZoom);
}
// Spike half-length: grows with the star and the ramp, but capped in
// SCREEN pixels (~52 px) via the PER-PIXEL footprint pxCtl.x -- the
// global uPxSize is a worst-axis constant, and using it here let flares
// balloon on the expanded near side of the tilted plane. Also capped
// sub-cell so the 3x3 lattice lookup never clips a spike, and never
// below the core radius (the disc must fit its own influence region).
float flareReach(float radius, float cellCap, float pxL) {
    float len = radius * mix(2.5, 7.0, flareRamp());
    return max(radius, min(min(len, pxL * 52.0), cellCap));
}
// pxCtl.y fades flares out approaching the horizon band, where extreme
// foreshortening stacks the spikes of many stars into vertical streaks.
// Diffraction flare, rebuilt on the reciprocal-core profile.
//
// The previous version built its spikes from exp(-|d|/thin) over a
// polynomial core. That falloff flattens toward the centre, so a star
// peaked at a finite value and read as a soft blob no matter how the
// amounts were tuned -- it was the SHAPE that was wrong, not the gain.
//
// This uses the profile the good reference starfields use: a 1/r core
// that climbs without bound toward the centre (so it saturates to a hard
// white pinpoint), plus spikes built from the PRODUCT |x*y|. That product
// is near zero along both axes at once, which draws a four-point star in
// one expression and tapers it naturally outward; a second pair rotated
// 45 degrees at lower weight makes it eight.
// Distant background stars -- the cosmos the galaxy sits in.
//
// SINGLE-CELL lattice: no 3x3 neighbour scan. The version this replaces
// scanned nine cells on every sky pixel and became the shader's single
// largest cost, which is why it was cut (see the note in the sky early-out).
// The scan is only needed when a star can reach across a cell border; keep
// each star inside the middle of its own cell and a pixel never has to look
// anywhere but the cell it stands in. ~3 hashes instead of ~36.
//
// Deliberately NOT rotated with the galaxy: these are distant, so they hold
// still while the disk turns. That is also one less rotate() per pixel.
// Value noise over one bilinear cell. hash1 is arithmetic only -- no trig --
// so four taps are cheap enough to afford full-screen.
// Exact-integer lattice hash for the value-noise corners.
//
// hash1 is fine for anything sampled once per cell, but value noise reads the
// SAME lattice corner from four neighbouring cells, and those four reads are
// four different expressions: hash1(i + vec2(1,0)) here, hash1(floor(x)) in
// the next cell. hash1 is chaotic by design -- a one-ulp difference in its
// input products becomes a completely different output -- so any compiler
// that regroups (i+1)*443.897 as i*443.897 + 443.897 gives a shared corner
// two different values, and the noise STEPS at that cell edge. Rotated with
// the gas frame, those steps are the hard diagonal lines seen on a Galaxy
// S24 Ultra and on no other test device: it is a compiler behaviour, not a
// resolution or display one.
//
// Every value here is an integer below 2^24 (max (576*34+1)*576 = 11.3M), so
// every operation is EXACT in float32, and exact arithmetic gives the same
// answer however it is grouped. The corner is identical from all four cells.
float lperm(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float lhash(vec2 i) {
    i = mod(i, 289.0);
    return lperm(lperm(i.x) + i.y) / 289.0;
}

// Interleaved gradient noise (Jimenez), for the output dither. hash1 feeds
// fragCoord * ~443 into fract(), and at a large render buffer those products
// reach ~1e6, where float32 has almost no fractional bits left: at the far
// corner of an S24 Ultra's 1080x2340 buffer it produced 390 distinct values
// in a 160x160 patch. IGN's inner multipliers are tiny, so it stays full
// precision at any resolution (25,600 of 25,600 in the same patch), and its
// spectrum is close to blue noise, which is what a dither wants.
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = x - i;
    f = f * f * (3.0 - 2.0 * f);
    float a = lhash(i);
    float b = lhash(i + vec2(1.0, 0.0));
    float c = lhash(i + vec2(0.0, 1.0));
    float d = lhash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Two octaves of gas, and two is the floor: one octave is visibly a lumpy
// gradient rather than cloud. Eight hash taps is the entire cost -- the rest
// is mix(). Thresholded hard and cubed, because gas that tints every pixel
// just lifts the black level; it has to sit in a minority of the sky as soft
// banks with real black between them.
/// rotate() with the angle's cosine and sine supplied instead of computed.
/// Matches rotate(p, t) exactly for cs = vec2(cos(t), sin(t)).
vec2 rotCS(vec2 p, vec2 cs) {
    return p * cs.x - vec2(p.y, -p.x) * cs.y;
}

vec3 nebulaField(vec2 pb, float amount) {
    // 3.2, not 1.15: pScreen spans y in [-1,1], so at 1.15 barely two noise
    // cells covered the whole screen and the "cloud" was a near-constant
    // value -- invisible, whatever the gain. This puts ~6 cells across the
    // frame, which is the scale banks actually read at.
    // The two octaves travel on DIFFERENT velocities, near enough to
    // opposite. One shared velocity only slides the same shape across the
    // screen; letting them pass through each other makes the banks form and
    // dissolve, which is the animation -- and it costs nothing, because both
    // samples were already being taken.
    // ~7x the earlier velocities. At 0.013 q-units/s the banks moved about
    // 2 px a second, which is real but sits under the threshold where slow
    // smooth motion registers at all -- the same trap the stars were in. The
    // two octaves also differ by more than direction now: the fine one runs
    // faster AND against the coarse one, so the interference churns instead
    // of sliding.
    // 4.6, not 3.2: at the coarser scale barely six cells covered the frame,
    // so a single low cell left a whole corner empty no matter how high the
    // floor went. More cells means the dark patches are small and everywhere,
    // instead of large and somewhere.
    // Rotation, not translation. A velocity gives every pixel the same
    // direction, and the eye reads the sum of the two octaves as one march
    // across the sky. A rotating sample frame has no net direction anywhere,
    // and unlike a spatially varying displacement it is RIGID -- nothing
    // stretches or squashes, which is what made the advected version read as
    // a rubber sheet.
    //
    // The angle depends only on time, so both rotations are uniform across
    // the frame: two multiply-adds per pixel, no extra noise taps.
    vec2 q = rotCS(pb, uGasRotA) * 4.6;
    // Octaves kept separate: their DIFFERENCE is a free region map. Both
    // samples were already being taken for the density, so the accent hue
    // below rides along at no cost -- and because the two travel on opposing
    // velocities, the colour regions drift through each other rather than
    // sitting fixed on the density they tint.
    float oc = vnoise(q);
    // Opposite sense and a faster rate, so the two octaves shear past each
    // other and the banks form and dissolve rather than turning as one disc.
    float fi = vnoise(rotCS(pb, uGasRotB) * 12.42 + vec2(17.3, 5.1));
    float n = oc * 0.65 + fi * 0.35;
    // Value noise clusters hard around 0.5, so a window of 0.46..0.92 threw
    // away nearly the whole distribution. Squared once (not cubed) keeps the
    // banks soft-edged without burying the amplitude.
    // Wide window and a gentle curve: a tight threshold plus a square made
    // dense purple islands with hard black between them. Opening the window
    // spreads the same noise over far more of the sky, and pow(,1.35) keeps
    // the falloff soft instead of squaring the middle out of existence --
    // thin veil everywhere, not a few saturated blobs.
    // Opened right up, with a floor under it. Even a wide threshold still
    // leaves large tracts at exactly zero, and those empty tracts are what
    // read as the gas being bunched up. A base wash everywhere plus softer
    // banks on top covers the frame instead of dotting it.
    n = smoothstep(0.08, 1.0, n);
    // The floor is what "spread" means: at 0 the noise decides where there is
    // any gas at all and it sits in isolated banks; at 1 gas covers the frame
    // and the noise only modulates it.
    float floorN = mix(0.05, 0.88, uGasSpread);
    n = floorN + (1.0 - floorN) * pow(n, 1.05);
    vec3 tint = mix(vec3(0.11, 0.14, 0.30), vec3(0.28, 0.19, 0.40), n);
    // Teal where the coarse octave leads, rose where the fine one does.
    // Kept desaturated and close in luminance to the base, so it reads as a
    // hue shift in the same gas rather than as coloured lights behind it.
    float hueMix = clamp(0.5 + (oc - fi) * 1.7, 0.0, 1.0);
    // Both accents pulled 30% toward their own luminance -- desaturated at
    // constant brightness, so the hue still reads but stops being a colour
    // wash. Baked into the literals rather than computed: the mix is fixed,
    // so there is no reason to pay for it per pixel.
    vec3 accent = mix(vec3(0.11, 0.24, 0.30), vec3(0.29, 0.15, 0.26), hueMix);
    tint = mix(tint, accent, uGasHue * 0.85);
    // Pedestal under the gas. Without it the gas lives at 8-bit luminance
    // ~2.3-10.5 at 0.35 brightness -- the band where panels disagree most:
    // OLEDs crush the lowest levels to black, so the dark half of the gas
    // simply vanished on some phones and showed on others. 0.06 lifts the
    // whole range by ~1.3 levels (to ~3.6-12) while keeping the
    // darkest-to-brightest span, so the banks keep their shape and clear the
    // darkest levels. It scales with amount: uNebula = 0 is
    // still pure black.
    const float GAS_PEDESTAL = 0.06;
    return tint * (n * 0.40 + GAS_PEDESTAL) * amount;
}

float bgStarField(vec2 pb, float latScale, float occScale) {
    // Fixed lattice. Cell size has to leave room for the largest star the
    // size slider can ask for, since the single-cell lookup only holds while
    // a star stays inside its own cell -- so COUNT is the occupancy roll
    // below, not the grid. That also lets count reach exactly zero.
    // 20: a cell is now ~60 rendered px, so a ~2.5 px star has room to
    // cross a visible distance before it wraps. Travel distance is capped by
    // cell size -- the lookup is single-cell -- so a coarse lattice is the
    // price of motion you can actually see. Occupancy scales by GRID^2 so the
    // count slider still means the same number of stars.
    const float GRID = 20.0;
    vec2 g = pb * GRID;
    vec2 cell = floor(g);
    vec2 f = g - cell;

    // Occupancy: most cells empty. Whole cells agree on this branch, so
    // warps skip together.
    float h = hash1(cell + vec2(3.1, 7.7));
    // occScale thins the field where the galaxy is. Scaling the occupancy
    // roll rather than the brightness means those stars are not drawn at all,
    // so the clearing is free -- cells that fail this test early-out before
    // any star math.
    float occ = 0.85 * uBgCount * occScale;
    if (h > occ) return 0.0;

    // One rendered pixel in cell units. pb is the screen frame scaled BY
    // latScale, so a screen pixel spans latScale-times FEWER cell units --
    // it multiplies, it does not divide. Dividing made every star grow as
    // the lattice pushed in (~2.2x by the end of the dive) on top of the
    // spread; multiplying holds pixel size dead constant, so the field only
    // ever opens outward.
    float pxCell = (2.0 / iResolution.y) * GRID * max(latScale, 1e-4);

    // Size, in PIXELS, and never sub-pixel. A star under ~1 px lands on a
    // fraction of one pixel, so its brightness swings with sub-pixel
    // position and the field shimmers -- that is aliasing, not twinkle.
    // The per-star roll varies size only ABOVE the floor, so the smallest
    // star is still a real one rather than a sparkle.
    // The slider is the CAP, and the per-star roll spans floor..cap. Scaling
    // a rolled size and then clamping instead pins most stars flat on the
    // floor -- at a low cap the majority of rolls land under it and every
    // star comes out the same 2 px, which is not randomisation at all.
    // Skewed (^1.7) so small stars dominate and the big ones stay occasional.
    const float FLOOR_PX = 2.0;
    float sizeHash = hash1(cell + vec2(51.7, 8.3));
    float capPx = FLOOR_PX + 4.5 * uBgSize;
    float rPx = mix(FLOOR_PX, capPx, pow(sizeHash, 1.7));
    float rDraw = max(rPx, FLOOR_PX) * pxCell;


    // Placement is sized AGAINST the star: `room` is how far a centre can sit
    // from the cell middle before the disc crosses into a neighbour, and the
    // lookup is single-cell, so a crosser is simply sliced off. Deriving it
    // from rDraw instead of a fixed inset means big stars pull in, small ones
    // roam wide, and nothing is ever clipped.
    float room = max(0.0, 0.5 - rDraw);
    vec2 sp = vec2(0.5) + (vec2(hash1(cell + vec2(19.3, 4.1)),
                                hash1(cell + vec2(2.7, 31.9))) - 0.5)
                          * (2.0 * room * 0.78);
    // Per-star drift: own direction, own speed, and only about half the
    // stars at all. One shared velocity moved the whole sky as a single
    // sheet, which the eye reads as a still image -- independent motion is
    // what makes it live. Travel wraps inside the cell (the lookup is
    // single-cell), and the star fades out before it reaches the edge and
    // back in on the far side, so the wrap is never seen.
    float edgeFade = 1.0;
    if (uBgDrift > 0.001 && hash1(cell + vec2(37.3, 12.1)) < 0.30) {
        float dirA = hash1(cell + vec2(8.8, 55.2)) * 6.2831853;
        float spd = mix(0.10, 0.35, hash1(cell + vec2(23.6, 71.4)));
        sp += vec2(cos(dirA), sin(dirA)) * spd * uBgDrift * uTwinkleTime;
        sp = fract(sp);
        vec2 e = min(sp, vec2(1.0) - sp);
        edgeFade = smoothstep(0.0, 0.10, min(e.x, e.y));
        if (edgeFade <= 0.0) return 0.0;
    }

    float d = length(f - sp) / rDraw;
    if (d >= 1.0) return 0.0;

    // Squared, not cubed: cubing buries nearly all the brightness in the
    // middle pixel, so a wider star just gains dark area.
    float core = 1.0 - d;
    core *= core;

    // Brightness variety, linear so the median star actually shows.
    float mag = 0.40 + 0.60 * (h / max(occ, 1e-5));
    // Twinkle on half the stars, and only inside a star, so the sin() is paid
    // on a tiny fraction of the frame. Selection uses its OWN hash: keying it
    // off h picked exactly the dimmest half (h also drives mag), so the
    // modulation rode on the stars least able to show it. Phase and rate get
    // their own rolls too -- h spans only 0..occ, so h-derived phases were
    // nearly identical and the field breathed in unison instead of
    // twinkling. Depth 0.15..1.0, since a shallow dip on a dim star is
    // invisible on a phone.
    float tw = 1.0;
    // Keyed off the SIZE roll, so only the bigger half twinkles: a 2 px star
    // has too little area for the modulation to register, and flickering it
    // just reads as aliasing. Free -- sizeHash is already in hand.
    if (sizeHash > 0.50 && h > occ * 0.45) {
        float ph = hash1(cell + vec2(63.1, 17.5)) * 6.2831853;
        float rate = 1.1 + 1.4 * hash1(cell + vec2(5.9, 41.7));
        // Peaks at 1.30, not 1.0: a twinkling star should out-shine its
        // steady neighbours at the top of the swing, not merely stop dimming.
        tw = 0.15 + 1.15 * abs(sin(uTwinkleTime * rate + ph));
    }
    return core * mag * tw * edgeFade;
}

float starFlare(vec2 d, float dist, float radius, float reach, float hs, float ang, float fvis, float fRand) {
    vec2 du = rotate(d, -ang);       // screen-aligned, not galaxy-aligned
    du.y *= cos(uCamTilt);           // approximate tilt foreshortening

    // Work in units of the flare's own reach, so the profile is scale-free
    // and the screen/cell caps on reach keep bounding it exactly as before.
    float rr = max(reach, 1e-6);
    vec2 q = du / rr;
    float r = max(length(q), 0.004);   // floor: the divide, not the look

    // Reciprocal core. Scaled by the star's own radius so a big star gets a
    // bigger pinpoint rather than every flare looking identical.
    float core = 0.020 * (radius / rr) / r;

    // Cross spikes. Larger SPIKE_K = thinner, sharper rays.
    const float SPIKE_K = 60.0;
    float sp = max(0.0, 1.0 - abs(q.x * q.y) * SPIKE_K);
    vec2 qr = rotate(q, 0.7853982);    // 45 degrees
    sp += max(0.0, 1.0 - abs(qr.x * qr.y) * SPIKE_K) * 0.3;

    // Per-star strength. hs already ties some variation to SIZE; fRand is an
    // INDEPENDENT roll, so two stars of the same size flare differently.
    // Squared so the distribution skews low: most stars stay modest and only
    // a few blaze. A field where everything flares equally reads as a
    // texture, not as stars.
    float amt = uFlare * flareRamp() * fvis * (0.45 + 0.55 * hs)
              * mix(0.15, 1.28, fRand * fRand);
    // Cut off inside the reach circle, as before, so nothing clips at a
    // visible disc edge.
    float edge = smoothstep(1.0, 0.2, r);
    return (core + sp * 0.45) * amt * edge;
}

// One star grid at a given LOD scale. lvlScale multiplies the grid so
// star spacing stays roughly constant on screen as the camera dives;
// BASE_R shrinks by the same factor so star size tracks spacing.
// keep = per-star presence probability (0..1): each star rolls its own
// hash against it, so lowering keep THINS the population (fewer stars at
// full brightness) instead of dimming every star. keep = 1.0 keeps all.
// Returns TWO fields from ONE lattice walk: .x = the full population
// (every star), .y = the keep-hash subset. Populations that share the
// same stars (arm mask + bulge in the flat path) get both maxes for the
// price of one walk, and the caller weights/combines them with the SAME
// expressions as the old two-pass code -- so the result is bit-identical,
// including through the LOD cross-fade (each field mixes across levels
// on its own, exactly as before; weighting after mixing). wantAll = 0.0
// restores the old single-population behavior: skip non-kept stars
// early (.x stays 0, unused) -- the cheap path for the sheet calls.
// How much the STAR arm band has fattened at this radius (uArmSpread).
// Shares the r 0.4 -> 1.15 ramp with the dissolve and the density
// thinning, so all three grow together toward the rim -- but each has
// its own slider, so width and density are dialled independently.
const float ARM_SPREAD_COMP = 0.60;

float armWiden(float r) {
    return smoothstep(0.4, 1.15, r) * clamp(uArmSpread, 0.0, 1.0);
}

// Radial presence probability for ARM stars (see uArmFalloff): 1 inside,
// thinning to 25% by the outer disk at full falloff. Shares the same
// radius ramp as the dispersion in armAngleMask so both effects grow
// together.
float armStarKeep(float r) {
    float keep = 1.0 - 0.75 * uArmFalloff * smoothstep(0.4, 1.15, r);
    // Rim coarsening (uRimCoarse): thin the OUTERMOST band harder still, so
    // the last stars read as separated points instead of fine grain. Starts
    // past r = 1.0, where uArmFalloff's ramp has already finished, so the
    // two do not fight -- falloff shapes the whole outer disk, this shapes
    // only the naked rim beyond the smoke. Purely a presence roll: the
    // survivors keep their exact size and brightness (the lattice cell size
    // CANNOT be varied per pixel -- neighbouring pixels would disagree on
    // where the stars are and the 3x3 window would tear), so this opens
    // space between stars without inflating them.
    // 0.60, not more: the thinning has to leave enough population for the
    // envelope's outward stretch (armRadialFade) to actually show. At 0.80
    // the two fought and the 1.4-1.6 band came out FEWER than baseline --
    // gaps opened but nothing reached further, which is not "spread out".
    keep *= 1.0 - 0.60 * clamp(uRimCoarse, 0.0, 1.0) * smoothstep(1.0, 1.5, r);
    // Spreading must REDISTRIBUTE stars, not breed them: a plateau of
    // half-width W widens the band from ~0.78 rad to ~(0.78 + W), so thin
    // the population by exactly that ratio. The same stars end up spread
    // over more sky -- which is what "loosened gravitational pull" should
    // mean -- instead of the arm simply gaining stars as it fattens.
    return keep / (1.0 + ARM_SPREAD_COMP * armWiden(r));
}

// armKeep thins the FULL-population field (.x) by a per-star presence
// roll on a dedicated hash -- fewer stars at full brightness, the same
// mechanism as the bulge's keep. It never touches the keep subset (.y),
// so a star thinned out of the arms can still appear as a bulge star.
// armKeep = 1.0 skips the roll entirely: bit-identical.
vec2 starFieldLevel(vec2 p, float lvlScale, float seed, float keep, vec2 parVec, float ang, vec3 pxCtl, float wantAll, float armKeep) {
    float GRID = (8.0 + 18.0 * uStarDensity) * lvlScale;
    // BASE_R is the nominal star size; each star scales it by a hashed
    // multiplier below so the field has small/large variety.
    float BASE_R = 0.009 / lvlScale;
    float pxFloor = uPxSize * 1.2;
    // Conservative rejection radius, computed once per lattice level. A
    // star can only reach this pixel from within (max reach + max sub-cell
    // shift). reach never exceeds max(0.9/GRID, pxFloor) -- flareReach
    // caps itself at the 0.9/GRID cell cap -- and the height shift is
    // clamped to 0.45/GRID, and is zero when there is no slab. Cells
    // outside that can be dropped BEFORE their size/radius/attenuation
    // and height-offset math, which is the bulk of the fixed per-cell
    // cost. Exact by construction: nothing that could draw is cut.
    float rejR  = max(0.9 / GRID, pxFloor);
    float rejR2 = rejR * rejR;
    vec2 cell = floor(p * GRID);
    vec2 result = vec2(0.0);

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 n = cell + vec2(float(dx), float(dy)) + vec2(seed * 57.0, seed * 113.0);

            // Short-circuit. Every ARM sheet call passes keep = 0, and
            // hash1 returns [0,1), so this can only ever be false there --
            // and those callers read .x, never the .y population it feeds.
            // GLSL && short-circuits, so the hash is skipped outright.
            bool kept = (keep > 0.0) && (hash1(n + vec2(5.7, 113.1)) <= keep);
            if (!kept && wantAll < 0.5) continue;

            float hx = hash1(n);
            float hy = hash1(n + vec2(31.41, 27.18));
            vec2 starPos = (n - vec2(seed * 57.0, seed * 113.0) + vec2(hx, hy)) / GRID;
            vec2 dCell = p - starPos;
            if (dot(dCell, dCell) > rejR2) continue;

            // Per-star size: hs^2 skews the distribution so most stars sit
            // near the small end and only a few reach the large end --
            // uniform sizes read as an artificial dot grid.
            float hs = hash1(n + vec2(7.31, 41.7));
            float sizeMul = mix(0.5, 1.8, hs * hs);
            // Cell-size cap: above star density ~2.9 the largest stars
            // would outgrow their lattice cell and clip at cell borders;
            // a no-op at the old density range (identity preserved).
            float starBase = min(BASE_R * sizeMul, 0.9 / GRID);
            // Energy-conserving anti-aliasing: if the screen can't resolve
            // this star (sub-pixel), draw it just large enough (~1.2 px)
            // but dimmed by the area ratio, so it reads as the same small
            // point of light -- no size inflation, no shimmer.
            // Deep-dive ceiling -- the other half of the pattern the floater
            // sheet has had all along (line ~519) and the main field never
            // got. Past the uMaxStarLod refill limit the dive stops adding
            // finer grid levels and simply MAGNIFIES the field it has, so
            // without a ceiling every star swells into a soft bubble. The
            // flare rides on radius, so fat stars also grew fat crosses --
            // capping here turns them back into thin needles for free.
            // No-op at rest and early dive: a star would have to exceed
            // ~6 px there and the largest is ~1 px. Cap by the MIN-axis
            // footprint so both screen dimensions stay bounded; min() on
            // atten keeps a capped star at full brightness on the smaller
            // radius (crisper, not dimmer).
            float radius = clamp(starBase, pxFloor, max(pxCtl.x * 6.0, pxFloor));
            float atten = min(1.0, (starBase / radius) * (starBase / radius));

            vec2 d = p - starPos;
            float dist = length(d);

            // Flares wake only in the dive's final stretch, on a ~30%
            // slice of SMALL stars: a small core with long thin spikes
            // reads as a crisp +, while big cores hit the screen cap at
            // ~2R with spike thickness scaling up (a fat diamond blob).
            // Everything else keeps the plain disc and its exact old cost.
            bool flaring = uFlare > 0.001 && uZoom < uFlareStart && hs > 0.15 && hs < 0.70;
            float reach = flaring ? flareReach(radius, 0.9 / GRID, pxCtl.x) : radius;
            if (dist < reach) {
                float core = dist < radius ? pow(1.0 - dist / radius, 2.5) * atten : 0.0;
                float flare = flaring
                    ? starFlare(d, dist, radius, reach, hs, ang, pxCtl.z,
                                hash1(n + vec2(23.9, 71.1))) * atten
                    : 0.0;
                if (core + flare > 0.0) {
                    float bright = (core + flare) * starTwinkle(n);
                    if (armKeep >= 0.999 || hash1(n + vec2(61.7, 12.9)) <= armKeep) {
                        result.x = max(result.x, bright);
                    }
                    if (kept) result.y = max(result.y, bright);
                }
            }
        }
    }
    return result;
}

// Zoom-adaptive starfield: as the camera dives (uZoom -> 0) blend between
// successive power-of-two star grids, so on-screen star size and density
// stay roughly constant -- flying THROUGH a starfield, not magnifying one.
// At uZoom = 1 this is exactly one grid at the original scale.
// Refill is capped at uMaxStarLod: past that many doublings, no finer grid
// spawns, so the existing stars keep growing/spreading as the dive
// continues -- this is what actually reads as flying PAST stars, instead
// of the field statistically refilling itself forever.
// Returns vec2 like starFieldLevel: .x = full population, .y = keep
// subset. Each component cross-fades between LOD levels on its own --
// the same scalar mix the old per-population passes ran -- so weighting
// and combining stay downstream and bit-identical.
vec2 starField(vec2 p, float keep, vec2 parVec, float ang, vec3 pxCtl, float wantAll, float armKeep) {
    float lod = min(max(0.0, log2(1.0 / max(uZoom, 0.0001))), uMaxStarLod);
    float l0 = floor(lod);
    float f = lod - l0;
    float s0 = exp2(l0);
    vec2 a = starFieldLevel(p, s0, l0, keep, parVec, ang, pxCtl, wantAll, armKeep);
    // The cross-fade weight f derives purely from uZoom, so this branch is
    // fully coherent; at rest (f = 0) it skips the second lattice level
    // entirely, halving the star pass. mix(a, b, 0) == a, so no visual
    // change where it fires.
    if (f < 0.001) return a;
    vec2 b = starFieldLevel(p, s0 * 2.0, l0 + 1.0, keep, parVec, ang, pxCtl, wantAll, armKeep);
    return mix(a, b, f);
}

// One SHEET of off-plane floater stars: a coarse lattice living at a fixed
// height hSheet above (or below) the galaxy plane. Instead of offsetting
// each star from its footprint (which is limited to sub-cell shifts by the
// 3x3 lookup), the WHOLE lattice is sampled in the sheet's exactly-shifted
// frame ps = p - hSheet * parVec -- lookup and star positions stay
// consistent, so the height can be arbitrarily large with zero clipping.
// That is what lets uFlatFloaters scatter stars visibly OFF the disk
// silhouette (the still-frame-readable 3D cue) instead of silently
// saturating a clamp. Per-star residual heights stay sub-cell.
float floaterSheet(vec2 p, vec2 parVec, float hSheet, float seed, vec2 pxMM, float ang, float fvis) {
    vec2 ps = p - parVec * hSheet;   // exact apparent frame of this sheet
    // Presence follows the exponential disk profile of the FOOTPRINT, so
    // floaters cluster over the galaxy even when their apparent position
    // hovers far off the rim.
    // Follow the BULGE's presence profile (exp(-r^2 * 7.0)) instead of the
    // old exp(-r * 1.1): a gaussian in r^2 concentrates floaters over the
    // disk and dies quickly, rather than trailing far past the spiral.
    // uFloaterSpread scales the RADIUS, so 1.0 == the bulge exactly.
    float sp = max(uFloaterSpread, 0.05);
    float keep = min(exp(-dot(ps, ps) * (7.0 / (sp * sp))), 1.0);
    // Denser grid costs nothing (the loop always checks 9 cells) but puts
    // ~60 stars per sheet over the disk instead of ~10 -- enough that the
    // ones landing OFF the silhouette read as a population, not strays.
    float GRID = max(uFloaterDensity, 1.0);
    // Near main-star scale: floaters read through their parallax slide
    // and the deep-dive size cap, not raw bulk -- oversizing them makes
    // mid-dive floaters balloon (no LOD refill) into bright "pimples"
    // against the refined swarm.
    // LOCAL FIX: shrink floaters on the SAME LOD ladder the main star field
    // uses (starFieldLevel: BASE_R = 0.009 / lvlScale). Upstream left this
    // fixed, so mid-dive the floaters kept their world-space size while the
    // view magnified -- they hit the 15px cap and read as big white bokeh
    // discs against the refined swarm. Dividing by the same lvlScale keeps
    // their apparent screen size stable all the way in. At rest uZoom = 1,
    // so lvl = 1 and this is bit-identical to upstream.
    float lodF = min(max(0.0, log2(1.0 / max(uZoom, 0.0001))), uMaxStarLod);
    float lvlF = exp2(lodF);
    // sqrt, not the full 1/lvlF: dividing by the whole ladder shrank them
    // so far they nearly vanished mid-dive. sqrt still kills the original
    // ballooning while keeping them present. uFloaterSize scales to taste.
    float BASE_R = 0.007 * uFloaterSize / sqrt(lvlF);
    vec2 cell = floor(ps * GRID);
    float result = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 n = cell + vec2(float(dx), float(dy)) + vec2(seed * 61.0, seed * 23.0);

            if (hash1(n + vec2(13.7, 57.3)) > keep) continue;

            float hx = hash1(n + vec2(1.7, 9.2));
            float hy = hash1(n + vec2(8.3, 2.6));
            vec2 starPos = (n - vec2(seed * 61.0, seed * 23.0) + vec2(hx, hy)) / GRID;

            // Per-star residual height so the sheet doesn't read as a
            // rigid plane; kept sub-cell (0.45/GRID) so the 3x3 lookup in
            // the sheet frame never clips.
            float hh = (hash1(n + vec2(3.7, 91.3)) - 0.5) * 2.0;
            vec2 hOff = parVec * (hh * min(abs(hSheet) * 0.5, 0.025));
            hOff *= min(1.0, (0.45 / GRID) / max(length(hOff), 1e-6));

            float hs = hash1(n + vec2(7.31, 41.7));
            float starBase = BASE_R * mix(0.45, 1.9, hs * hs); // wider spread: sizes read as varied, not uniform discs
            // Grow on screen as the dive closes in, but cap at ~15 px so
            // a deep zoom never inflates a floater into a huge blob; the
            // sub-pixel end keeps the same energy-conserving AA as the
            // main field. Cap by the MIN-axis footprint (pxMM.x) so BOTH
            // screen dimensions stay bounded -- a plane-space disc capped
            // by the worst axis still stretched into a wide white oval on
            // foreshortened regions. Floor by the MAX axis (pxMM.y) for
            // resolvability; the max() keeps the clamp range valid where
            // anisotropy is extreme.
            float radius = clamp(starBase, pxMM.y * 1.2, max(pxMM.x * 8.0, pxMM.y * 1.2));
            float atten = min(1.0, (starBase / radius) * (starBase / radius));

            float dist = length(ps - starPos - hOff);

            // Floaters DO flare now. They were left glowing-only when the
            // flare was the old exp()-over-polynomial profile, which on these
            // chunky off-plane stars was indistinguishable from the main
            // field's. The reciprocal-core profile reads very differently at
            // this size, and floaters sit above the plane where the spikes
            // are least likely to be lost in the swarm.
            // Every floater is eligible now; strength alone decides. The
            // roll doubles as the gate, so the bottom ~15% come out at zero
            // flare -- "no flare" is part of the distribution rather than a
            // separate arbitrary subset. Keeping that as a branch matters:
            // a floater that skips flaring also skips the widened reach, so
            // the cheap path stays cheap for the stars drawing nothing.
            float fr = hash1(n + vec2(17.7, 52.3));
            bool flaring = uFlare > 0.001 && uZoom < uFlareStart && fr > 0.15;
            float reach = flaring ? flareReach(radius, 0.9 / GRID, pxMM.x) : radius;
            if (dist < reach) {
                float core = dist < radius
                    ? pow(1.0 - dist / radius, 2.5) * atten
                    : 0.0;
                // starFlare's own curve floors at 0.15 of full strength, so
                // the ramp is applied here to carry the weakest rolls the rest
                // of the way to nothing. Floaters only -- the main field keeps
                // its floor.
                // fr * 0.88 into starFlare's strength curve. The curve is
                // mix(0.15, 1.60, fRand^2), so scaling the input squeezes the
                // TOP -- the brightest floater flare drops ~1.60 to ~1.27 --
                // while the weak ones, which sit near the fixed 0.15 floor,
                // barely move. A flat multiply would have dimmed everything
                // evenly; this caps the peak, which is what was shouting.
                float flare = flaring
                    ? starFlare(ps - starPos - hOff, dist, radius, reach, hs,
                                ang, fvis, fr * 0.88) * atten
                      * smoothstep(0.15, 0.45, fr)
                    : 0.0;
                result = max(result, (core + flare) * starTwinkle(n));
            }
        }
    }
    return result;
}

float fbmdisk(vec2 p) {
    float f = 1.0;
    float r = 0.0;
    for (int i = 1; i < 7; i++) {
        r += abs(noise(p*f))/f;
        f += 1.0;
    }
    return 1.0/max(r, 0.0001);
}

float fbmdust(vec2 p) {
    float f = 1.0;
    float r = 0.0;
    for (int i = 1; i < 7; i++) {
        r += 1.0/max(abs(noise(p*f)), 0.0001)/f;
        f += 1.0;
    }
    float q  = clamp(1.0 - 1.0/max(r, 0.0001), 0.0, 1.0);
    float q2 = q * q;
    return q2 * q2;
}

float theta(float r, float wb, float wn){
    return atan(exp(1.0/r)/wb)*2.0*wn;
}

// Edge-anchored radius warp for the spiral PATTERN only. r = 1.5 (approx
// disk edge, where exp(-r*r) has killed everything) maps to itself and the
// center maps to the center, so theta sweeps the same total angle across
// the disk -- the number of winds never changes, only where the turns sit.
float spacingWarp(float r) {
    return 1.5 * pow(r / 1.5, uArmSpacing);
}

// Phase wobble for the arm pattern (uArmWobble): one zero-centred noise
// tap in the ROTATING pattern frame, so the imperfection is baked into
// the spiral and spins rigidly with it -- nothing crawls, morphs, or
// winds tighter over time (the gas-clouds lesson). A phase offset moves
// an arm radially by offset/(d theta/d r), which is naturally tiny near
// the centre where the coil is dense; the amplitude ramp on top keeps
// the inner spiral crisp while the outer windings wander by up to
// ~0.7 rad of phase at full slider. Position-based (not phase-based),
// so opposite arms de-symmetrise -- part of the organic look.
float armWobble(vec2 p, float r) {
    if (uArmWobble < 0.001) return 0.0;
    float amp = uArmWobble * 0.7 * (0.25 + 0.75 * smoothstep(0.25, 0.95, r));
    return amp * noise(p * 1.8 + vec2(5.2, 1.3));
}


// Angular cross-section of the STAR arms: independent WIDTH and EDGE
// SHARPNESS. (Smoke does not use this -- see the note in arm().)
//
// Width comes from a PLATEAU, not from lowering the exponent. Easing the
// exponent down does widen the band, but it also lifts the profile's
// floor (0.739^k), which floods the inter-arm gaps with stars; pinning
// that floor back down then cancels most of the widening, so the spread
// slider degenerated into a dimmer. Instead the falloff is pushed
// OUTWARD by W radians, giving a flat full-brightness top of half-width
// W with the original edge steepness intact on both sides. Width and
// sharpness stop fighting each other, and the floor barely moves.
float armProfile(float phase, float aw, float r) {
    float sk = clamp(uArmEdgeSkew, 0.0, 1.0);
    float w  = armWiden(r);                 // 0..1, uArmSpread x radius ramp
    float P  = pow(1.15, aw);
    // Both controls idle -> the original expression, bit for bit.
    if (sk < 0.001 && w < 0.001) return pow((1.0 - 0.15*sin(phase)) / 1.15, aw) * P;

    // Signed angular distance from the crest (the band peaks where
    // sin(phase) = -1, i.e. phase = -PI/2), wrapped to [-PI, PI].
    float d = mod(phase + 1.5707963 + 3.1415927, 6.2831853) - 3.1415927;
    // Plateau: hold full crest brightness across |d| < W, then run the
    // ORIGINAL falloff from there outward. sin(-PI/2 + x) == -cos(x), so
    // the shifted profile is just (1 + 0.15*cos(|d| - W)) / 1.15.
    // ...and the plateau leans with the skew. A flat top centred on the
    // crest is a symmetric pedestal the exponent skew below cannot touch,
    // so it dilutes the asymmetry badly: at spread 0.55 the flank ratio
    // fell from 3.3:1 (no plateau) to 1.8:1, which is why max skew read as
    // weak. Slide the SAME total plateau outward instead -- Wout + Win
    // stays 2W, so the cross-section is untouched -- and at full skew the
    // flat top starts right at the crest and runs outward only.
    float W  = w * 1.15;
    float Wd = W * (1.0 + sk * (1.0 - 2.0 * step(0.0, d)));
    float ad = max(abs(d) - Wd, 0.0);
    float base = (1.0 + 0.15*cos(ad)) / 1.15;

    // Asymmetric flanks (uArmEdgeSkew) -- the density-wave look: gas piles
    // up in a shock on the arm's inner edge (sharp) while material trails
    // off outward (feathered). The crest is exactly where base == 1, and
    // 1^K == 1 for any K, so the two flanks can run DIFFERENT exponents
    // and still meet perfectly -- continuous in value AND slope (the
    // profile is quadratic-flat at its peak), so there is no seam and
    // nothing clips. Area-preserving pair: a flank's width goes as
    // 1/sqrt(exponent), so holding (1/sqrt(sIn) + 1/sqrt(sOut)) == 2 keeps
    // the cross-section while the flanks trade sharpness for feathering.
    float K = aw;
    if (sk >= 0.001) {
        float a = 1.0 - 0.85 * sk;              // inner half-width factor
        float b = 1.0 + 0.85 * sk;              // outer half-width factor
        // Blend zone deliberately NARROW. It used to span +-0.8 rad, but at
        // full skew the inner edge falls off within ~0.15 rad of the crest,
        // so the flank was still only ~3/4 of the way to its steep exponent
        // by the time it had already faded -- the sharpening was being spent
        // out in the tail where nothing is visible. Tightening it costs
        // nothing (the crest is flat in value and slope regardless of K, so
        // there is still no seam) and lets each flank reach its real
        // exponent where it actually shows.
        float side = smoothstep(-0.3, 0.3, d);  // 0 = outer flank, 1 = inner
        K = mix(aw / (b * b), aw / (a * a), side);
    }

    // Trough pinning, now only mopping up the small residual the plateau
    // and the skew leave behind: remap this profile's [trough, crest] onto
    // the ORIGINAL arm's [trough, crest] so the gaps between arms stay
    // exactly as dark as they were. baseMin is the true minimum of the
    // shifted profile (at |d| = PI), so the mapping is exact -- per side,
    // since the two flanks now run different plateaus. The crest stays
    // seamless regardless: base == 1 there, and f(1) == 1 for any lo.
    float baseMin = (1.0 - 0.15*cos(Wd)) / 1.15;
    float lo    = pow(baseMin, K);
    float loRef = exp(-0.302283 * aw);
    float f = (pow(base, K) - lo) / (1.0 - lo) * (1.0 - loRef) + loRef;
    return f * P;
}

// Angular cross-section of the SMOKE arms: armProfile's edge skew without
// its width plateau -- the smoke keeps its fixed width on purpose (see the
// NOTE in arm()), but uSmokeSkew sharpens its inner edge and feathers its
// outer edge by the same area-preserving flank-exponent trade the stars
// use, so the gas can agree with the stars about which side of the arm is
// the shock front. Same trough pinning: at |d| = pi both flanks land on
// the plain profile's floor (pow(base,K) == lo there for either K), so the
// gaps hold their darkness AND the two flanks meet seamlessly mid-gap.
// The crest is exact for the same reason as armProfile: base == 1 there
// and the remap maps 1 to 1 for any flank exponent.
float smokeProfile(float phase, float aw) {
    float sk = clamp(uSmokeSkew, 0.0, 1.0);
    // Skew idle -> the original expression, bit for bit.
    if (sk < 0.001) return pow(1.0 - 0.15*sin(phase), aw);
    // Signed angular distance from the crest (phase = -PI/2), [-PI, PI].
    float d = mod(phase + 1.5707963 + 3.1415927, 6.2831853) - 3.1415927;
    float base = (1.0 + 0.15*cos(d)) / 1.15;
    float a = 1.0 - 0.85 * sk;              // inner half-width factor
    float b = 1.0 + 0.85 * sk;              // outer half-width factor
    float side = smoothstep(-0.3, 0.3, d);  // 0 = outer flank, 1 = inner
    float K = mix(aw / (b * b), aw / (a * a), side);
    float lo    = pow(0.7391304, K);        // trough of base: (1-0.15)/1.15
    float loRef = exp(-0.302283 * aw);      // same trough at the plain aw
    float f = (pow(base, K) - lo) / (1.0 - lo) * (1.0 - loRef) + loRef;
    return f * pow(1.15, aw);
}

float arm(float n, float aw, float wb, float wn, vec2 p){
    float t = atan(p.y, p.x);
    float r = length(p) + 1e-4;
    float rw = spacingWarp(r);
    // Hard outer taper, shoulder well INSIDE the star arms' (1.0 vs 1.25):
    // the smoke sheet is gone by r ~ 1.25 while the star arms run on to
    // ~1.55, so the outer star tail sits on plain black with no haze
    // backdrop. (This deliberately reverses the old near-parity tuning,
    // where the smoke veil outlived the last stars by ~0.3.) Identity
    // below the shoulder.
    float ex = max(r - 1.0, 0.0);
    // NOTE: the smoke arm keeps the plain fixed-WIDTH profile on purpose.
    // The outward widening lives ONLY on the star arms (armAngleMask ->
    // armProfile) -- spreading the smoke too made the whole nebula fatten,
    // which is not what was wanted: the gas keeps its shape, the stars
    // come loose from it. Edge SKEW, though, is available to the smoke as
    // its own control (smokeProfile / uSmokeSkew).
    return smokeProfile((theta(rw,wb,wn)-t)*n + armWobble(p, r), aw) * exp(-r*r) * exp(-0.07/r) * exp(-ex*ex*10.0);
}

// Radial envelope of the STAR arms alone (no angular structure). Outer
// taper: past r = 1.25 the arms dissolve into the disk instead of
// trailing off as long solid ribbons; exactly identity below the
// shoulder, and since the star mask CUBES this, the tail fragments into
// sparse dots well before zero. Deliberately gentler and later than the
// smoke arm's taper (shoulder 1.25/coeff 3 vs 1.0/coeff 10): the stars
// are the OUTERMOST structure, running to ~1.55 as scattered dots on
// plain black after the smoke sheet has already died at ~1.25. Exposed
// separately because the uArmSpread dissolution blends the full mask
// toward THIS envelope -- stars scattered anywhere on the annulus, arm
// pattern gone.
float armRadialFade(float r) {
    float radialFade = exp(-r * 0.65) * exp(-0.07/r);
    // uRimCoarse carries the rim population FURTHER OUT as well as thinning
    // it: the outer taper's shoulder slides out and its falloff softens, so
    // the survivors scatter into a wider, sparser halo instead of stopping
    // at the same edge. Thinning alone only opened gaps in a band that
    // still ended where it always did -- which is not what "spread out"
    // means. Stars only (the smoke keeps its own early taper in arm(), so
    // this widens the gap between the two on purpose). Full slider reaches
    // ~r 1.9, well inside the r 2.5+ far-field cut, so nothing clips.
    // c = 0 restores the exact old taper.
    float c  = clamp(uRimCoarse, 0.0, 1.0);
    float ex = max(r - (1.25 + 0.45 * c), 0.0);
    return radialFade * exp(-ex * ex * mix(3.0, 1.1, c));
}

float armAngleMask(float n, float aw, float wb, float wn, vec2 p){
    float t = atan(p.y, p.x);
    float r = length(p) + 1e-4;
    float rw = spacingWarp(r);
    // Same wobble field as the smoke arm (armWobble is position-based),
    // so the stars keep tracing the same wandering arms as the gas.
    return armProfile((theta(rw,wb,wn)-t)*n + armWobble(p, r), aw, r) * armRadialFade(r);
}

// Dissolution weight: how much of the CUBED star mask blends toward the
// isotropic annulus weight at this radius. This is the SECONDARY half of
// the outer spread -- it fills the inter-arm gaps with stray stars, but
// on its own it leaves the crest as narrow as ever (that is why the arms
// still read as a thread until armProfile started widening the band too).
// Deliberately weaker than the widening so the arms fatten and blur
// rather than washing straight out into a uniform ring.
float armDissolve(float r) {
    return smoothstep(0.4, 1.15, r) * clamp(uArmSpread, 0.0, 1.0) * 0.55;
}

// Smoky galaxy body only: arms + dust + disk + a fixed central glow.
// Stars are computed separately in mainImage so they can carry their own
// color (uStarColor) instead of inheriting the smoke tint.
// Takes two coordinates: ps drives the arm STRUCTURE (may be elliptical)
// and pd drives the texture DETAIL (dust/disk noise) which stays round,
// so ovalness never smears the grain like a stretched image. With
// uOvalness = 1 both are identical.
// Returns the two body components SEPARATELY so each gets its own slider:
//   .x = arm smoke  (smoky filaments tracing the spiral arms)
//   .y = core glow  (the broad bright haze at the nucleus the arms don't
//                    reach -- the old central bulge glow)
// mainImage scales each by its amount and max-combines them, so at equal
// amounts the result is exactly the old max(armTerm, glowTerm).
vec2 smokeMap(vec2 ps, vec2 pd){
    float a = arm(uArmCount, 6.0, 0.7, uArmWinding, ps);
    float d = fbmdust(pd);
    float armTerm = a*(0.4+0.1*arm(uArmCount+1.0, 4.0, 0.7, uArmWinding, ps*m2))*(0.1+0.6*d+0.4*fbmdisk(pd));
    // uCoreGlowSpread scales the WIDTH of both glow gaussians (dividing
    // the exponent) with their peaks untouched -- reach and intensity are
    // independent controls. At 1.0 the multiplier is exactly 1: identity.
    // Both gaussians are CENTRED on the nucleus. The tight one used to sit
    // at a fixed 0.2 offset (a V1 relic) -- in the rotating pattern frame,
    // so it read as a bright blob slowly orbiting the black hole, obvious
    // once uCoreGlowSpread tightened the halo around it.
    float gInv = 1.0 / (uCoreGlowSpread * uCoreGlowSpread);
    float glow = exp(-dot(ps,ps)*1.2*gInv) + 0.5*exp(-dot(ps,ps)*12.0*gInv);
    float glowTerm = glow*(0.7+0.2*d+0.2*fbmabs(pd));
    return vec2(armTerm, glowTerm);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = 2.0*fragCoord.xy/iResolution.xy - 1.0;
    // Nudge the galaxy up the screen. Applied to p only: the background
    // stars and gas keep the screen frame, so the galaxy shifts within the
    // sky rather than dragging the whole cosmos with it.
    p.y -= uLiftY;
    // Aspect correction. The mapping above normalises BOTH axes to [-1,1]
    // independently, so without this the whole scene stretches to whatever
    // shape the canvas happens to be: the same uniforms gave a galaxy of
    // width:height 1.53 in the 9:19.5 phone frame, 1.32 at 1:1 and 2.19 at
    // 16:9, and on a square canvas it flattened AND overflowed the sides.
    // (It reads as a camera-tilt problem because a flattened disk is what
    // a steeper tilt looks like -- but uCamTilt is not what changed.)
    //
    // Corrected RELATIVE to the portrait frame everything was authored
    // against (420 x 868), not to 1:1: at that aspect the factor is
    // exactly 1.0, so the tuned defaults render bit-identically and only
    // other canvas shapes are compensated. Scaling the SHORTER-relative
    // axis (max(f, 1) on each) rather than shrinking one keeps the galaxy
    // inside the frame instead of letting it overflow.
    // 392x840 is the CANVAS, not the 420x868 phone frame -- the frame's
    // 14px border is inside it. This is the surface every default was
    // judged on, so it is the aspect that must stay untouched.
    const float REF_ASPECT = 392.0 / 840.0;      // authoring aspect (w/h)
    float aspect = iResolution.x / max(iResolution.y, 1.0);
    float f = aspect / REF_ASPECT;               // 1.0 at the phone frame
    p *= vec2(max(f, 1.0), max(1.0 / f, 1.0));
    p.x = -p.x;
    // Screen frame kept before the ray/plane step overwrites p with the disk
    // hit. The background lives on the screen, not on the galaxy plane -- it
    // must not inherit the plane's perspective stretch or its rotation.
    //
    // Built from fragCoord rather than from p: p normalises BOTH axes to
    // [-1,1] independently, so one x unit spans the width and one y unit the
    // height. A circle in that frame is an ellipse on screen -- the galaxy
    // hides it (it is a tilted disk anyway) but background stars came out
    // visibly stretched vertically. Dividing both axes by the SAME number
    // keeps pixels square.
    vec2 pScreen = (fragCoord - 0.5 * iResolution.xy) * (2.0 / iResolution.y);
    // Look-at perspective camera: the camera orbits the galaxy center at a
    // uZoom-scaled distance, tilted uCamTilt off top-down, and always AIMS
    // AT THE ORIGIN -- so the core/black hole stays pinned to screen center
    // at every tilt, and the dive (shrinking uZoom = moving the camera in)
    // flies straight into the hole, not at some off-center patch of stars.
    // Closed-form ray/plane intersection, no marching. At uCamTilt = 0 this
    // reduces EXACTLY to the flat mapping p * 1.65 * uZoom.
    //   camera pos (0, -D*st, D*ct), forward (0, st, -ct),
    //   right (1, 0, 0), up (0, ct, st), ray = forward + FOV*(sx,sy) basis.
    // FOV sets perspective strength (smaller = flatter, more telephoto);
    // D compensates so on-screen framing stays constant as FOV changes.
    // The 1.65 framing constant (was 2.0) sits the galaxy ~20% closer,
    // trimming the dead space around it at rest.
    const float FOV = 0.3;
    float camD = 1.65 * uZoom / FOV;
    float ct = cos(uCamTilt);
    float st = sin(uCamTilt);
    float denom = ct - p.y * FOV * st;   // -(ray dir).z
    // Rays with denom <= 0 point above the horizon and never hit the plane;
    // fade the galaxy out approaching that boundary and floor the divisor
    // so the fallback coordinate stays finite (no precision banding).
    float groundVis = smoothstep(0.03, 0.12, denom);
    float rayT = camD * ct / max(denom, 0.05);
    // Height-parallax basis: a star floating h above the plane appears,
    // in this pixel's z = 0 plane frame, shifted by exactly h * parVec
    // (closed form from the same ray -- (d.x, d.y) / -d.z). Divisor
    // floored like rayT's; the per-star sub-cell clamp in the star loops
    // handles the near-horizon blowup. Built from SCREEN coords, so it
    // must be computed before p is overwritten with the plane hit.
    vec2 parVec = vec2(p.x * FOV, st + p.y * FOV * ct) / max(denom, 0.05);
    // Per-pixel star sizing/flare controls. The LOCAL plane footprint of
    // one screen pixel, both axes: horizontal is rayT-based, vertical
    // differentiates the plane-hit y through rayT(sy) -- they follow the
    // perspective, unlike the global uPxSize. Screen-pixel CAPS must use
    // the MIN axis (x): stars/spikes are plane-space discs, so capping by
    // the worst axis bounds only the compressed screen dimension and lets
    // the other stretch to cap x (vFoot/hFoot) -- the "big white oval"
    // bug on foreshortened regions. AA FLOORS use the MAX axis (y) so a
    // star stays resolvable on its most compressed dimension.
    // z = flare visibility, fading before the horizon band where
    // foreshortening stacks many stars' spikes into vertical streaks.
    float dRayT = camD * ct * FOV * st / (max(denom, 0.05) * max(denom, 0.05));
    float hFoot = rayT * FOV * 2.0 / iResolution.x;
    float vFoot = abs(dRayT * (st + p.y * FOV * ct) + rayT * FOV * ct) * 2.0 / iResolution.y;
    vec3 pxCtl = vec3(min(hFoot, vFoot), max(hFoot, vFoot),
                      smoothstep(0.10, 0.20, denom));
    p = vec2(rayT * p.x * FOV,
             -camD * st + rayT * (st + p.y * FOV * ct));

    // Sampled pre-rotation so the background field stays fixed in place
    // while the spiral spins underneath it, instead of orbiting with it.
    vec2 pBg = p;

    // Far-field early-out: beyond the galaxy's outermost contribution --
    // and in the sky band past the horizon -- only the background stars
    // and the dither can produce non-black output, so skip both smoke
    // stacks and every star lattice. Every falloff (smoke exp(-r^2), the
    // gaussian bulge, arm taper, core glow) is sub-quantization
    // past r = 2.5. Radial branch = spatially
    // coherent. Real savings: at rest tilt the sky band alone is a big
    // slice of the frame.
    // Background stars, computed BEFORE the sky branch. Confining them to
    // the sky path would stop them dead at rCut = 2.5 while the visible
    // galaxy ends near 1.5, leaving a bare ring where they simply vanish.
    // Diving pulls the sampled region in slightly so the backdrop drifts
    // with the plunge instead of sitting behind it like painted glass.
    // Fade out as the plunge reaches the flare window: by then the camera is
    // inside the disk, and a static backdrop behind a field of streaking
    // stars is exactly what makes the two read as separate layers. Gone
    // before the flares arrive, so the finale is the swarm alone.
    // uZoom is a uniform, so the skip below is fully warp-coherent.
    float bgFade = smoothstep(uFlareStart * 1.0, uFlareStart * 2.6, uZoom);
    // Push in with the plunge: linear in depth, the way it was, just three
    // times as far (0.18 of drift -> 0.54). The squared, much harder version
    // read as the backdrop lurching away on its own rather than the camera
    // moving through it.
    float bgScale = mix(1.0, 0.46, 1.0 - uZoom);
    // Clear a hole around the spiral. The disk's own stars are dense and
    // bright there, and a background field behind them reads as clutter
    // rather than depth -- it also competes with the floaters, which are the
    // cue actually selling the third dimension. length(p) is galaxy-centred
    // and already carries the screen lift, so the clearing follows the galaxy
    // rather than the middle of the screen. Never reaches zero: a hard-edged
    // empty disc would be more obvious than the clutter it removes.
    float bgClear = mix(0.18, 1.0, smoothstep(0.85, 2.30, length(p)));
    float bgStars = (uBgCount > 0.001 && bgFade > 0.001)
        ? bgStarField(pScreen * bgScale, bgScale, bgClear) * bgFade
        : 0.0;
    // Gas rides the same frame and the same fade as the stars, so the
    // backdrop pushes in and clears as one layer.
    // Gas gathers where the stars are. Real nebulae sit in the galactic
    // plane, so weighting it by distance from the disk is both the honest
    // shape and nearly free: length(p) is already in hand, and it costs one
    // smoothstep for the whole frame. Never drops to zero -- the far field
    // keeps a thin wash so the frame edges do not read as a cut-off.
    float gasWeight = 1.0;
    vec3 bgGas = (uNebula > 0.001 && bgFade > 0.001)
        ? nebulaField(pScreen * bgScale, uNebula) * bgFade * gasWeight
        : vec3(0.0);

    float rCut = 2.5;
    if (groundVis < 0.001 || dot(p, p) > rCut * rCut) {
        // Beyond the galaxy body and above the horizon: empty sky. Only
        // the dither remains, to kill 8-bit banding on the near-black
        // gradient. (The sparse background starfield used to paint here;
        // it was removed -- barely visible, and it cost a 3x3 lattice
        // scan on every sky pixel.)
        // Same tone curve and fade as the body path below. Without them the
        // sky and body halves of the frame graded the backdrop differently,
        // and with the gas now covering everything that mismatch drew a hard
        // ellipse right at rCut -- a seam in the sky, not a halo.
        vec3 skyCol = vec3(bgStars) + bgGas;
        skyCol = pow(clamp(skyCol, 0.0, 1.0), vec3(0.9)) * uFade;
        // Full 8-bit step: the gas spans only ~10 levels, and a half-step
        // dither cannot break a band edge that wide.
        skyCol += (ign(fragCoord) - 0.5) * (2.0 / 255.0);
        fragColor = vec4(skyCol, 1.0);
        return;
    }

    // Ovalness frame (Sa/Sb), built BEFORE rotation so the ellipse's long
    // axis stays fixed horizontal on screen (like a projected disk) instead
    // of spinning with the arms; then rotated into the pattern frame so the
    // spiral elongates naturally as it sweeps past the long axis. Structure
    // only -- texture detail keeps sampling the round frame p, so nothing
    // looks stretched. Warp is split evenly (sqrt on each axis) so
    // uOvalness IS the resulting axis ratio.
    float ovA = sqrt(uOvalness);          // arm frame: axis ratio = uOvalness
    vec2 pO1 = vec2(p.x / ovA, p.y * ovA);

    float ang = -uRotSpeed * iTime; // negative = clockwise spin
    p = rotate(p, ang);
    vec2 pOval = rotate(pO1, ang);
    // Parallax basis carried into the spinning lattice frame (rotate is
    // linear, so vectors transform the same way as positions).
    vec2 parRot = rotate(parVec, ang);

    // Inside the hole/core disc the CORE section's mix runs at exactly
    // coreMask == 1 (its smoothstep saturates at the lower edge), which
    // discards every body term computed before it. Skip them outright --
    // smoke, gas clouds, stars -- so the deepest dive frames and the
    // 0.7 s hold (hole covering much of the screen) get cheaper, bit for
    // bit. rim/coreGlow are added AFTER the mix and stay live. Uses the
    // same length(p) the CORE section feeds smoothstep, so the boundary
    // pixel lands identically. Spatially coherent branch (a disc).
    bool inHole = length(p) <= uBlackHoleSize * 0.45;

    // Haze extinction during the deep dive: the smoke lingers around the
    // viewer well into the zoom (full until zoom 0.18) and only then
    // dissipates quickly, fully gone by 0.03 as the core takes over --
    // the reference ends black behind the star swarm. Deliberately
    // non-linear: rest and most of the dive see exactly the full haze.
    // Killing the haze also skips the smokeMap call (the frame's
    // heaviest work) at the very end -- the deepest zoom gets FASTER as
    // it gets darker.
    float hazeVis = smoothstep(0.03, 0.18, uZoom);
    // Shared dive modulation applied to EVERY haze component: the deep-dive
    // extinction (hazeVis) and the come-alive pulse. The four amount
    // sliders scale on top of this.
    float hazeMod = hazeVis * uHazePulse;
    // Main smoke body = arm smoke (.x) and core glow (.y), each on its own
    // slider, then max-combined (equal amounts == the old body, bit for
    // bit). Gates are on uniforms -> coherent; skips the heavy smokeMap
    // when both are off, in the hole, or the haze is extinct deep in dive.
    bool bodyOn = hazeMod > 0.001 && !inHole && (uArmSmoke > 0.001 || uCoreGlow > 0.001);
    vec2 sm = bodyOn ? smokeMap(pOval, p) : vec2(0.0);
    float smoke = hazeMod * max(uArmSmoke * sm.x, uCoreGlow * sm.y);
    // Gas clouds: a sparse second layer of soft fog banks floating OVER
    // the disk (reference video: gauze drifting through the dark winding
    // gaps). Deliberately NOT arm-masked -- over the star-packed arms the
    // banks wash out, but in the gaps nothing competes with them, so the
    // layer reads without touching star brightness (the item-24 rule).
    // Sampled in its own rotation frame at 78% of the spiral's angular
    // speed: the banks visibly slide relative to the arms, and the dive's
    // ramped clock accelerates both together, keeping the drift parallel.
    // Fades out mid-dive, earlier than the main haze; the uniform gate
    // skips all of it once extinct or disabled, so the dive only gets
    // cheaper. Cost when on: one rotate + three noise taps.
    float cloudVis = smoothstep(0.32, 0.55, uZoom);
    float gas = 0.0;
    if (uGasClouds > 0.001 && cloudVis > 0.001 && !inHole) {
        // Gas frame: a rigid slight lag (5% behind the spiral -- the gas
        // visibly trails) plus a FIXED baked wind-up that combs the field
        // along the flow. The wind-up is deliberately NOT multiplied by
        // time: a time-growing differential shear winds the pattern
        // tighter forever (after a couple of minutes the patches smeared
        // into pure streamlines), whereas a constant one gives the
        // half-caught-up look immediately and holds it -- the layer's
        // character is now stationary no matter how long it idles. The
        // living motion comes from the rigid lag and the wDrift morph
        // below, both statistically stationary.
        float rc = length(pOval) + 1e-4;
        float wind = 0.10 * smoothstep(0.2, 1.3, rc);
        // pOval already carries the arms' -uRotSpeed*iTime, so this coefficient
    // is a DIFFERENCE, not a speed: positive cancels part of the spin (the
    // clouds lag), negative adds to it (they overtake). The old constant
    // 0.05 is uCloudSpin = 0.4167.
    // Asymmetric: -1.5 of the arms' rate below the midpoint, +4.0 above it.
    // The slider therefore runs 0.5x BACKWARDS -> locked at 0.5 -> 5.0x
    // forwards at the top. The lead side is the one that needs the range:
    // wDrift morphs the cloud SHAPES continuously, and rotation only becomes
    // legible once it clearly outruns that morph. Keeping the lag side at
    // 3.0 leaves the useful reverse and stationary points inside the slider
    // instead of crushed into its first tenth. Shipped 5% lag = 0.4833.
    float cloudRel = (0.5 - uCloudSpin) * mix(3.0, 8.0, step(0.5, uCloudSpin));
    vec2 pc = rotate(pOval, cloudRel * uRotSpeed * iTime + wind);
        // Band anchor: the streak CENTERLINES use the non-lagging frame,
        // so the clouds stay locked mid-gap forever -- with the lag on
        // this too they slowly migrated onto the windings (the "caught
        // up speed" look after a minute). Only the texture inside the
        // streaks (waves/mottle/breakup, sampled at the lagging pc)
        // visibly trails the spiral.
        float tC = atan(pOval.y, pOval.x);
        // Averaging two rotated low-frequency taps cancels the sin-basis
        // chevron ridges (raw noise() reads as zigzag herringbone at low
        // frequency) -> smooth, near-isotropic waves. The two taps crawl
        // in OPPOSITE directions, so their sum doesn't just translate --
        // the wave shapes themselves slowly morph: cheap turbulence.
        vec2 wDrift = vec2(0.0026, 0.0016) * iTime;
        float na = noise(pc * 0.8 + vec2(9.2, 2.6) + wDrift);
        float nb = noise(m2 * pc * 0.8 + vec2(4.4, 7.7) - wDrift);
        float nw = (na + nb) * 0.5;                        // wave field
        float n2 = noise(m2 * pc * 3.2 + vec2(1.9, 5.3) + wDrift * 1.7);
        // The streaks follow the SAME log-spiral phase family as arm() --
        // identical theta/spacingWarp math, so the clouds run parallel to
        // the actual windings instead of sitting across them (sin keeps
        // it seam-free). The wave field bends the streak edges into long
        // soft waves; the drifting pc frame slides the whole pattern
        // along/through the gaps over time.
        float ph = (theta(spacingWarp(rc), 0.7, uArmWinding) - tC) * uArmCount
                 + 1.6 * nw;
        float band = smoothstep(-0.4, 0.85, sin(ph));
        // Along-spiral breakup: the coil dissolves into cloud patches
        // instead of reading as one solid painted spiral.
        float breakup = smoothstep(-0.40, 0.60, nw * 1.2 + n2 * 0.15);
        // Disk envelope: offset well INSIDE the spiral -- the gas lives
        // between the windings and is fully gone before the outer arm
        // taper, so the tapered spiral ends stay clean and nothing
        // stretches past the rim; thins at the very center so the core
        // glow stays clean.
        float cEnv = smoothstep(1.35, 0.95, rc) * smoothstep(0.10, 0.40, rc);
        // 0.275 gain: halved from 0.55 so the full slider range maps to a
        // subtler layer -- slider 1.0 now gives what 0.5 used to.
        gas = uGasClouds * band * breakup * (0.85 + 0.15 * n2) * cEnv
            * cloudVis * uHazePulse * 0.275;
    }
    // Stars: a single-plane field. Depth comes from the floater layer
    // below (uFlatFloaters), not from stacked height sheets.
    float starsV;
    if (inHole) {
        starsV = 0.0;
    } else {
        // Oval arm mask decides WHERE stars live; the round starField
        // decides WHAT they look like -- stars trace the oval arms as
        // round dots. Bulge population shares the same lattice, so max()
        // never double-brightens a shared star.
        float rOv = length(pOval);
        // Arm dissolution (uArmSpread via armDissolve): blend the cubed
        // mask toward the bare annulus weight -- outer stars scatter
        // anywhere on the ring instead of hugging the ridge ("loosened
        // gravitational pull"). (uArmFalloff is the presence thinning.)
        float sAng = armAngleMask(uArmCount, 6.0, 0.7, uArmWinding, pOval);
        float sFade = armRadialFade(rOv);
        float starMask = mix(sAng * sAng * sAng,
                             (sFade * sFade * sFade) * 0.55, armDissolve(rOv));
        // Gaussian PRESENCE falloff for the bulge/disk population,
        // CONCENTRATED at the center (reference: the core cluster is as
        // packed as the arm roots, and the between-arm sprinkle dies off
        // quickly). The 2.4 gain saturates keep to 1 near the center at
        // the default uBulge -- a fully-populated cluster -- and the
        // sharper exponent (7.0, was 3.2) collapses the tail so bulge
        // stars stop washing evenly across the mid-disk. uBulge now
        // mostly grows the RADIUS of the saturated cluster.
        float bulgeKeep = min(uBulge * 2.4 * exp(-dot(p, p) * 7.0), 1.0);
        // ONE lattice walk serves both populations (they share the same
        // stars): .x is the full field the arm mask weights, .y is the
        // bulgeKeep subset -- combined with the exact expressions the old
        // two full passes used, at half the lattice work.
        vec2 sf = starField(p, bulgeKeep, parRot, ang, pxCtl, 1.0, armStarKeep(length(pOval)));
        starsV = max(starMask * sf.x * 1.5, sf.y * 1.5 * 0.8);

        // Cheap 3D cue on the flat path: the same sparse floater sheets the
        // thick path uses, at the same real parallax (ps = p - parVec*h), but
        // WITHOUT the per-star residual machinery or the extra full-lattice
        // sheet passes. GRID is 5 here vs ~62 for the main field, so this is
        // a fraction of one lattice walk. Uniform-gated, so it stays coherent
        // and costs exactly nothing at 0.
        if (uFlatFloaters > 0.001) {
            // ONE sheet, above the plane only. The mirrored -Hf sheet doubled
            // the cost of this layer for a cue that reads fine from one side.
            float Hf = uFlatFloaters * 0.05;
            starsV = max(starsV,
                floaterSheet(p, parRot, Hf, 1.0, pxCtl.xy, ang, pxCtl.z) * 1.25);
        }
    }

    // groundVis gates every galaxy-body term so the region beyond the
    // horizon (see camDenom above) reads as clean black/background instead
    // of the saturated fallback coordinate.
    float k  = uCompactness * smoke * groundVis;              // smoky spiral body
    float sV = uCompactness * starsV * groundVis;             // star layer
    float dist = length(pOval); // structural radius: tints/glows follow the oval
    float rCore = length(p);    // true radius: the core itself stays round

    // --- COMPOSE ---
    // Single mode. The boom palette, uColorTransition, the corona and the
    // white-core branch were removed at handoff: the product ships the
    // resting spiral only. galaxy_editor_with_boom.html keeps the two-mode
    // original for reference.
    // Center tint fades out on a gaussian -- no visible edge, unlike a
    // smoothstep band which reads as a drawn circle. uCenterSpread sets
    // how far the tint reaches (weight = exp(-d^2/spread^2)).
    float centerW = exp(-(dist * dist) / (uCenterSpread * uCenterSpread));
    // Exact decomposition of the original grayscale formula
    //   lum = (0.2*kA^2 + 0.7*kA) / 3,  kA = k + sV   (the 0.4*b glow term
    //   left with the removed secondary glow layer)
    // split by source: expanding kA^2 = k^2 + 2*k*sV + sV^2, the body keeps
    // its own square, the star term absorbs the cross term (star-on-arm
    // pixels lean toward the star color). With the colors equal the terms
    // sum back to exactly lum * tint while different colors recolor only
    // their own element.
    vec3 nHue = mix(uNormalArmColor, uNormalCenterColor, centerW);
    vec3 normalCol = nHue              * ((0.2 * k * k + 0.7 * k) / 3.0)
                   + uNormalStarColor  * ((0.2 * (sV * sV + 2.0 * k * sV) + 0.7 * sV) / 3.0);
    vec3 normalLayer = clamp(normalCol, 0.0, 1.6);

    // Gas-cloud gauze, tinted like the nebula in each mode. Added before
    // the core mix so the hole / white core still punches through, and
    // additively over the body so stars shine through the banks.
    float gasG = gas * groundVis;
    normalLayer += uNormalHazeColor * gasG * 0.85;

    // --- CORE: black hole only. No rim glow, and a wide soft edge, so
    // surrounding haze and stars feather gently into the void. (The white
    // core was uCoreMode = 1; with it gone, rim and coreGlow were both
    // identically zero and are dropped outright.)
    float coreMask = 1.0 - smoothstep(uBlackHoleSize*0.45, uBlackHoleSize*1.60, rCore);
    normalLayer = mix(normalLayer, vec3(0.0), coreMask);

    float bgLum = max(normalLayer.r, max(normalLayer.g, normalLayer.b));
    float bgOcc = clamp(bgLum * 2.5, 0.0, 1.0);
    // Exponential, not a clamped multiply: `clamp(bgLum * 8.0)` saturated at
    // a luminance of 0.125, which drew a hard line right where the disk's
    // faint halo begins -- gas full strength on one side, cut dead on the
    // other. That visible border is what a hard knee looks like. This ramps
    // smoothly and never saturates, so the halo occludes gradually, which is
    // what a semi-transparent halo should do.
    float gasOcc = 1.0 - exp(-bgLum * 4.5);
    vec3 finalCol = normalLayer
                  + (bgStars * (1.0 - bgOcc) + bgGas * (1.0 - gasOcc))
                    * (1.0 - coreMask);

    finalCol = pow(clamp(finalCol, 0.0, 1.0), vec3(0.9));
    finalCol *= uFade;

    // Sub-quantization dither: the haze's exponential tail falls below
    // 1/255 along a smooth contour, and without this the 8-bit output
    // truncates it to black there -- a visible oval terminator around the
    // galaxy. Half a bit of static per-pixel noise breaks that band edge
    // up, so the haze keeps fading perceptually all the way into space.
    finalCol += (ign(fragCoord) - 0.5) * (2.0 / 255.0);

    fragColor = vec4(finalCol, 1.0);
}

out vec4 fragColor;

void main() {
    vec2 fragCoord = FlutterFragCoord().xy;
    // The shader body was written for a y-up frame (WebGL); Flutter's
    // FlutterFragCoord is y-down. One flip restores it.
    fragCoord.y = iResolution.y - fragCoord.y;
    mainImage(fragColor, fragCoord);
}
