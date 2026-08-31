// Flutter FragmentProgram port of the spiral-galaxy shader
// Shader body is line-for-line identical to the one in
// galaxy_editor.html, the browser tuning tool.
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
                                // (clean starfield), 1 = full. Stars are
                                // independent of this.
uniform float uDiskThickness;   // 0 = flat disk (exactly the old look).
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
    return smoothstep(0.22, 0.07, uZoom);
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
float starFlare(vec2 d, float dist, float radius, float reach, float hs, float ang, float fvis) {
    vec2 du = rotate(d, -ang);       // screen-aligned, not galaxy-aligned
    du.y *= cos(uCamTilt);           // approximate tilt foreshortening
    float thin = radius * 0.22;
    // x*x rather than pow(x, 2.0): pow is an exp2/log2 pair on most GPUs
    // and mobile compilers do not reliably fold a constant exponent.
    // Mathematically exact, so the image cannot shift.
    float tx = max(0.0, 1.0 - abs(du.x) / reach);
    float ty = max(0.0, 1.0 - abs(du.y) / reach);
    float sx = exp(-abs(du.y) / thin) * (tx * tx);
    float sy = exp(-abs(du.x) / thin) * (ty * ty);
    // Tight halo: at 2R the glow is already down to ~13%. A wider sigma
    // barely decays inside the reach circle and smears every flared star
    // into a fog blob -- the spikes, not the bloom, carry the look.
    float bloom = exp(-(dist * dist) / (radius * radius * 2.0));
    float amt = uFlare * flareRamp() * fvis * (0.45 + 0.55 * hs);
    // Taper the whole flare to exactly zero at the reach boundary: the
    // bloom is still above black there (badly so when the screen cap
    // pins reach at ~2R on big stars), and truncating it mid-glow drew
    // every flared star inside a visible clipped disc.
    float edge = 1.0 - smoothstep(reach * 0.65, reach, dist);
    return (0.5 * (sx + sy) + 0.25 * bloom) * amt * edge;
}

// One star grid at a given LOD scale. lvlScale multiplies the grid so
// star spacing stays roughly constant on screen as the camera dives;
// BASE_R shrinks by the same factor so star size tracks spacing.
// keep = per-star presence probability (0..1): each star rolls its own
// hash against it, so lowering keep THINS the population (fewer stars at
// full brightness) instead of dimming every star. keep = 1.0 keeps all.
// partLo/partHi split the population between height sheets: each star
// rolls a dedicated hash and belongs to exactly one [lo, hi) bucket, so
// two sheets with (0, 0.5) and (0.5, 1) together contain EXACTLY the
// original population -- density never changes, stars just get dealt out
// across heights. The flat path passes (0, 1) = keep everything.
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
vec2 starFieldLevel(vec2 p, float lvlScale, float seed, float keep, vec2 parVec, float partLo, float partHi, float ang, vec3 pxCtl, float wantAll, float armKeep, float resid) {
    float GRID = (8.0 + 18.0 * uStarDensity) * lvlScale;
    // BASE_R is the nominal star size; each star scales it by a hashed
    // multiplier below so the field has small/large variety.
    float BASE_R = 0.009 / lvlScale;
    float pxFloor = uPxSize * 1.2;
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

            // Sheet-partition gate (skipped entirely on the flat path,
            // where partHi = 1 -- keeps thickness 0 at zero extra cost).
            // hp does double duty: the window it falls in deals the star
            // to a sheet, and its position INSIDE that window is the
            // star's continuous height within the sheet's slice of the
            // slab (consumed by the resid shift below).
            float hp = 0.0;
            if (partHi < 1.0 || partLo > 0.0) {
                hp = hash1(n + vec2(43.1, 7.7));
                if (hp < partLo || hp >= partHi) continue;
            }

            float hx = hash1(n);
            float hy = hash1(n + vec2(31.41, 27.18));
            vec2 starPos = (n - vec2(seed * 57.0, seed * 113.0) + vec2(hx, hy)) / GRID;

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
            float radius = max(starBase, pxFloor);
            float atten = (starBase / radius) * (starBase / radius);

            // Slab placement: hp rescaled within this sheet's window is
            // the star's continuous height inside the sheet's slice, and
            // resid (half a slice, in height units) spans it so one
            // sheet's stars reach exactly to the neighbouring sheet's --
            // the slab fills edge to edge with NO repeated strips at any
            // thickness. This replaces the old independent fuzz, which
            // saturated at thickness 1 (min(T, 1) * 0.004) while the
            // sheet spacing kept growing: past T ~ 1 every arm rendered
            // as parallel plates with vacuum between. parVec turns the
            // height into its exact apparent shift; the clamp keeps it
            // sub-cell so the 3x3 lookup never clips a shifted star.
            // Where the clamp bites (far field, deep LOD), nSheet keeps
            // the sheet pitch within ~2 star spacings, too fine for the
            // eye to group into rows. Gated on the uniform (coherent):
            // a flat disk skips the math entirely, bit for bit.
            vec2 hOff = vec2(0.0);
            if (uDiskThickness > 0.001 && resid > 0.0) {
                float hpLocal = (hp - partLo) / max(partHi - partLo, 1e-5);
                hOff = parVec * ((hpLocal * 2.0 - 1.0) * resid);
                hOff *= min(1.0, (0.45 / GRID) / max(length(hOff), 1e-6));
            }

            vec2 d = p - starPos - hOff;
            float dist = length(d);

            // Flares wake only in the dive's final stretch, on a ~30%
            // slice of SMALL stars: a small core with long thin spikes
            // reads as a crisp +, while big cores hit the screen cap at
            // ~2R with spike thickness scaling up (a fat diamond blob).
            // Everything else keeps the plain disc and its exact old cost.
            bool flaring = uFlare > 0.001 && uZoom < 0.22 && hs > 0.25 && hs < 0.55;
            float reach = flaring ? flareReach(radius, 0.9 / GRID, pxCtl.x) : radius;
            if (dist < reach) {
                float core = dist < radius ? pow(1.0 - dist / radius, 2.5) * atten : 0.0;
                float flare = flaring ? starFlare(d, dist, radius, reach, hs, ang, pxCtl.z) * atten : 0.0;
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
vec2 starField(vec2 p, float keep, vec2 parVec, float partLo, float partHi, float ang, vec3 pxCtl, float wantAll, float armKeep, float resid) {
    float lod = min(max(0.0, log2(1.0 / max(uZoom, 0.0001))), uMaxStarLod);
    float l0 = floor(lod);
    float f = lod - l0;
    float s0 = exp2(l0);
    vec2 a = starFieldLevel(p, s0, l0, keep, parVec, partLo, partHi, ang, pxCtl, wantAll, armKeep, resid);
    // The cross-fade weight f derives purely from uZoom, so this branch is
    // fully coherent; at rest (f = 0) it skips the second lattice level
    // entirely, halving the star pass. mix(a, b, 0) == a, so no visual
    // change where it fires.
    if (f < 0.001) return a;
    vec2 b = starFieldLevel(p, s0 * 2.0, l0 + 1.0, keep, parVec, partLo, partHi, ang, pxCtl, wantAll, armKeep, resid);
    return mix(a, b, f);
}

// One SHEET of off-plane floater stars: a coarse lattice living at a fixed
// height hSheet above (or below) the galaxy plane. Instead of offsetting
// each star from its footprint (which is limited to sub-cell shifts by the
// 3x3 lookup), the WHOLE lattice is sampled in the sheet's exactly-shifted
// frame ps = p - hSheet * parVec -- lookup and star positions stay
// consistent, so the height can be arbitrarily large with zero clipping.
// That is what lets high uDiskThickness values scatter stars visibly OFF
// the disk silhouette (the still-frame-readable 3D cue) instead of
// silently saturating a clamp. Per-star residual heights stay sub-cell.
float floaterSheet(vec2 p, vec2 parVec, float hSheet, float seed, vec2 pxMM) {
    vec2 ps = p - parVec * hSheet;   // exact apparent frame of this sheet
    // Presence follows the exponential disk profile of the FOOTPRINT, so
    // floaters cluster over the galaxy even when their apparent position
    // hovers far off the rim.
    float keep = min(exp(-length(ps) * 1.1), 1.0);
    // Denser grid costs nothing (the loop always checks 9 cells) but puts
    // ~60 stars per sheet over the disk instead of ~10 -- enough that the
    // ones landing OFF the silhouette read as a population, not strays.
    float GRID = 5.0;
    // Near main-star scale: floaters read through their parallax slide
    // and the deep-dive size cap, not raw bulk -- oversizing them makes
    // mid-dive floaters balloon (no LOD refill) into bright "pimples"
    // against the refined swarm.
    float BASE_R = 0.007;
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
            float starBase = BASE_R * mix(0.7, 1.4, hs * hs);
            // Grow on screen as the dive closes in, but cap at ~15 px so
            // a deep zoom never inflates a floater into a huge blob; the
            // sub-pixel end keeps the same energy-conserving AA as the
            // main field. Cap by the MIN-axis footprint (pxMM.x) so BOTH
            // screen dimensions stay bounded -- a plane-space disc capped
            // by the worst axis still stretched into a wide white oval on
            // foreshortened regions. Floor by the MAX axis (pxMM.y) for
            // resolvability; the max() keeps the clamp range valid where
            // anisotropy is extreme.
            float radius = clamp(starBase, pxMM.y * 1.2, max(pxMM.x * 15.0, pxMM.y * 1.2));
            float atten = min(1.0, (starBase / radius) * (starBase / radius));

            float dist = length(ps - starPos - hOff);

            // Floaters never flare: big capped cores can only grow short
            // thick spikes (diamond blobs, not + stars). They render as
            // soft round bokeh discs -- exactly what the reference's
            // biggest end-frame stars are; the crisp + crosses live on
            // the small main-field stars instead.
            if (dist < radius) {
                float brightness = pow(1.0 - dist / radius, 2.5) * atten;
                result = max(result, brightness * starTwinkle(n));
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
    // past r = 2.5; the margin grows with uDiskThickness so off-plane
    // floater sheets are never clipped. Radial branch = spatially
    // coherent. Real savings: at rest tilt the sky band alone is a big
    // slice of the frame.
    float rCut = 2.5 + uDiskThickness * 0.25;
    if (groundVis < 0.001 || dot(p, p) > rCut * rCut) {
        // Beyond the galaxy body and above the horizon: empty sky. Only
        // the dither remains, to kill 8-bit banding on the near-black
        // gradient. (The sparse background starfield used to paint here;
        // it was removed -- barely visible, and it cost a 3x3 lattice
        // scan on every sky pixel.)
        float farDither = (hash1(fragCoord) - 0.5) * (1.0 / 255.0);
        fragColor = vec4(vec3(farDither), 1.0);
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
        vec2 pc = rotate(pOval, 0.05 * uRotSpeed * iTime + wind);
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
    // Stars. Flat path (uDiskThickness = 0): the original single-plane
    // field, bit for bit, zero extra cost. Thick path: the SAME arm and
    // bulge populations are dealt out across N height sheets each, every
    // star at a continuous height inside its sheet's slice of the slab --
    // N grows with the slider, see below (partition hash -- no density
    // change) -- with the arm
    // mask and disk falloff evaluated at every sheet's own FOOTPRINT so
    // stars keep tracing the arms they belong to. Arms stay a thin slab;
    // the bulge gets ~3x the height (it's the puffy spheroid); the sparse
    // floater layer scatters furthest. All uniform-gated -- coherent.
    float starsV;
    if (inHole) {
        starsV = 0.0;
    } else if (uDiskThickness > 0.001) {
        // Rim height taper on the ARM slab: sheet footprints separate by
        // 2*h*parVec, and parVec grows ~1/denom toward the far rim -- at
        // high tilt the outermost sheets end up sampled a large fraction
        // of r apart out there.
        // While smoke covered the rim and the star
        // annulus died by ~1.4 that read as thickness; with the outer band
        // now naked scattered stars (armRadialFade to ~1.55), each sheet's
        // rim became its own legible edge -- "two sheets of paper". Collapse
        // the slab toward a single plane across exactly that naked band:
        // full height inside r = 1.0 (bit-identical there), 15% by r = 1.5.
        // Driven by the PIXEL's plane radius, so both sheets converge
        // symmetrically and the lo/hi population split is untouched. The
        // bulge keeps its full height (its gaussian is dead out there), and
        // the floater strays stay detached by design.
        float hEnv   = 1.0 - 0.85 * smoothstep(1.0, 1.5, length(pOval));
        float hDisk  = uDiskThickness * 0.008 * hEnv;  // arm slab half-height
        float hBulge = uDiskThickness * 0.025;  // bulge spheroid half-height
        // Sheets tile the slab in CONTIGUOUS slices, and every star sits
        // at a continuous height inside its slice: the partition hash both
        // deals the star to a sheet and, rescaled within the sheet's
        // window, places it between the sheet planes (the resid shift in
        // starFieldLevel). The height distribution is therefore uniform
        // across [-h, +h] BY CONSTRUCTION -- repeated strips cannot form
        // at any thickness. The previous scheme (fixed sheet heights plus
        // an independent fuzz saturating at thickness 1) could not get
        // there: through the 1-3 range it resolved to 2-3 sheets whose
        // spacing dwarfed the fuzz, so every arm still read as parallel
        // paths. nSheet ~ 2T - 1 keeps the sheet pitch fine enough wherever
        // the sub-cell clamp truncates the residuals (far field, deep LOD)
        // that the eye cannot group it into rows; the hEnv rim taper
        // shrinks pitch and residuals together, staying coherent.
        // Population split is untouched: each sheet carries 1/N of the
        // SAME field -- repartitioned, never duplicated -- so the star
        // count is conserved exactly, and the SLAB HEIGHT is set by
        // uDiskThickness alone, not by N. The count was briefly 2T, which
        // put 3 sheets at the 1.35 default; measured against 2 sheets at
        // 1.32 Mpx that third sheet was invisible at rest at both 1.35 and
        // 3.0 while costing ~17% of the frame, so it was margin against
        // the sub-cell clamp rather than something the eye needed. Now
        // 1.35 runs 2 sheets, thickness 3 runs 5, the cap is 8. uDiskThickness is a uniform, so N is identical for
        // every pixel and the break stays fully coherent. Constant bound +
        // break because the editor targets GLSL ES 1.00 (WebGL1), which
        // forbids a non-constant loop bound; 8 caps the unrolled size.
        int   nSheet = int(clamp(ceil(uDiskThickness * 2.0 - 1.0), 2.0, 8.0));
        float invN   = 1.0 / float(nSheet);
        // Residual half-range per population: half of one slice, in the
        // population's own height units, so residuals meet exactly at the
        // slice boundaries -- no gap, no overlap.
        float residArm   = hDisk * invN;
        float residBulge = hBulge * invN;
        starsV = 0.0;
        for (int s = 0; s < 8; s++) {
            if (s >= nSheet) break;
            // Sheet frames sit at slice CENTERS (s = 0 topmost): with the
            // +/- half-slice residuals they tile [-h, +h] edge to edge.
            float t   = 1.0 - (2.0 * float(s) + 1.0) * invN;
            float lo  = float(s) * invN;
            float hi  = lo + invN;
            // Arm sheet: footprint built in the unrotated frame (pBg) so
            // the oval warp stays screen-aligned, then rotated like p.
            // The ENVELOPE is evaluated per sheet, not shared: hoisting it
            // to the mid-plane was tried and reverted, because the mask
            // position is itself a carrier of thickness -- pinning it
            // froze the arm BAND at the mid-plane so only stars inside a
            // fixed band could shift, and the arms stopped thickening with
            // the slider while the bulge (which kept its own per-sheet
            // footprint) went on spreading.
            vec2 aU = pBg - parVec * (t * hDisk);
            vec2 aOval = rotate(vec2(aU.x / ovA, aU.y * ovA), ang);
            vec2 aRot = rotate(aU, ang);
            float rAOv = length(aOval);
            // Arm dissolution (uArmSpread via armDissolve): blend the
            // cubed mask toward the bare annulus weight -- outer stars
            // scatter anywhere on the ring instead of hugging the ridge.
            // (uArmFalloff is the separate presence thinning.)
            float aAng = armAngleMask(uArmCount, 6.0, 0.7, uArmWinding, aOval);
            float aFade = armRadialFade(rAOv);
            float aMask = mix(aAng * aAng * aAng,
                              (aFade * aFade * aFade) * 0.55, armDissolve(rAOv));
            // Skip the lattice wherever the mask/falloff already caps the
            // contribution below the 1/255 dither floor -- most of the
            // frame. Radially/arm-shaped regions, so the branch stays
            // spatially coherent.
            if (aMask > 0.0005) {
                // wantAll = 1 with the arm-thinning roll on .x: at
                // armStarKeep = 1 this is the exact old keep=1 field.
                // rAOv reused rather than recomputing length(aOval).
                starsV = max(starsV, aMask * starField(aRot, 0.0, parRot, lo, hi, ang, pxCtl, 1.0, armStarKeep(rAOv), residArm).x * 1.5);
            }
            // Bulge sheet: gaussian falloff drives PRESENCE at the sheet
            // footprint -- near-flat over the core, collapsing hard with
            // radius so the diffuse scatter stays concentrated instead of
            // trailing far outside the disk; 0.8x keeps arms dominant.
            vec2 bRot = rotate(pBg - parVec * (t * hBulge), ang);
            float bKeep = min(uBulge * 2.4 * exp(-dot(bRot, bRot) * 7.0), 1.0);
            if (bKeep > 0.003) {
                starsV = max(starsV, starField(bRot, bKeep, parRot, lo, hi, ang, pxCtl, 0.0, 1.0, residBulge).y * 1.5 * 0.8);
            }
        }
        // Floater sheets: sparse chunky strays at the largest heights --
        // past ~2 on the slider they visibly detach from the silhouette.
        float H = uDiskThickness * 0.05;
        starsV = max(starsV, max(floaterSheet(p, parRot, H, 1.0, pxCtl.xy),
                                 floaterSheet(p, parRot, -H, 2.0, pxCtl.xy)) * 1.25);
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
        vec2 sf = starField(p, bulgeKeep, parRot, 0.0, 1.0, ang, pxCtl, 1.0, armStarKeep(length(pOval)), 0.0);
        starsV = max(starMask * sf.x * 1.5, sf.y * 1.5 * 0.8);
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

    vec3 finalCol = normalLayer;

    finalCol = pow(clamp(finalCol, 0.0, 1.0), vec3(0.9));
    finalCol *= uFade;

    // Sub-quantization dither: the haze's exponential tail falls below
    // 1/255 along a smooth contour, and without this the 8-bit output
    // truncates it to black there -- a visible oval terminator around the
    // galaxy. Half a bit of static per-pixel noise breaks that band edge
    // up, so the haze keeps fading perceptually all the way into space.
    finalCol += (hash1(fragCoord) - 0.5) * (1.0 / 255.0);

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
