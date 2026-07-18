// Neutral-palette spiral galaxy, tilted perspective view, with a central
// black hole. Arm/dust/disk math adapted from S.Guillitte's galaxy shader
// (CC BY-NC-SA 3.0) - morphology reference:
// http://iopscience.iop.org/0004-637X/783/2/138/pdf/0004-637X_783_2_138.pdf
// Shadertoy-compatible: paste directly into Shadertoy's Image tab (custom
// uniforms read as 0 there, so wire them to constants for a quick preview).
// V1.3, exported verbatim from galaxy_editor_1.html. New since V1.2:
// look-at perspective camera with dive tilt (uCamTilt), 3D disk thickness
// with height-parallax star sheets (uDiskThickness), star diffraction
// flares + bloom on the final dive stretch (uFlare), star LOD cap
// (uMaxStarLod), per-pixel star footprints (perspective-correct sizing),
// far-field early-out, gaussian bulge falloff, closer 1.65 framing,
// dive "come alive" haze pulse (uHazePulse), nebula haze split into
// four components (uArmSmoke/uCoreGlow/uGlowLayer/uCorona; the old
// single uHaze == all four equal), drifting gas-cloud layer
// with a gap-anchored shape (uGasClouds), gaussian center tint
// (uCenterSpread), and split normal-mode colors (uNormal*). Every new
// uniform's zero value restores the older math where one existed.
//
// Host-supplied globals (Shadertoy provides these automatically):
//   iResolution (vec2 canvas pixels), iTime (rotation clock; the dive
//   accelerates it 5x-20x -- see FLUTTER_IMPLEMENTATION.md).

uniform float uZoom;
uniform float uFade;
uniform float uRotSpeed;

// Sandbox controls
uniform float uColorTransition;
uniform float uArmCount;
uniform float uArmWinding;
uniform float uArmSpacing;      // radial spacing between arm turns without
                                // changing how many there are; see spacingWarp().
                                // >1 opens the center, <1 opens the rim. 1.0 = original.
// --- Nebula haze, split into four independently-scaled components (each
// is amount x hazeMod x its own shape; 0 = that piece hidden). Stars are
// separate. The old single uHaze == all four at the same value.
uniform float uArmSmoke;        // smoky filaments tracing the spiral arms
uniform float uCoreGlow;        // broad bright haze at the nucleus
uniform float uCoreGlowSpread;  // radial REACH of the core glow with the
                                // center intensity pinned (gaussian width
                                // scale; the peak of a gaussian is
                                // independent of its width). 1.0 = the
                                // original shape, <1 hugs the core,
                                // >1 extends outward.
uniform float uGlowLayer;       // soft diffuse secondary glow (the b layer)
uniform float uCorona;          // tight bright bloom right at the core
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
uniform float uCoreMode; // 0.0 = black hole, 1.0 = bright white core
uniform float uBlackHoleSize;
uniform vec3 uCenterColor;
uniform vec3 uArmColor;
uniform vec3 uOuterHazeColor;   // nebula glow (b layer + corona)
uniform vec3 uStarColor;
// Normal mode's palette: same four roles as boom's, driving an exact
// decomposition of the original grayscale formula -- with all four left at
// the same neutral gray the output is bit-identical to the old single-tint
// look, and editing one recolors only that element (arms/center/haze/stars).
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
    float sx = exp(-abs(du.y) / thin) * pow(max(0.0, 1.0 - abs(du.x) / reach), 2.0);
    float sy = exp(-abs(du.x) / thin) * pow(max(0.0, 1.0 - abs(du.y) / reach), 2.0);
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
vec2 starFieldLevel(vec2 p, float lvlScale, float seed, float keep, vec2 parVec, float partLo, float partHi, float ang, vec3 pxCtl, float wantAll) {
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

            bool kept = hash1(n + vec2(5.7, 113.1)) <= keep;
            if (!kept && wantAll < 0.5) continue;

            // Sheet-partition gate (skipped entirely on the flat path,
            // where partHi = 1 -- keeps thickness 0 at zero extra cost).
            if (partHi < 1.0 || partLo > 0.0) {
                float hp = hash1(n + vec2(43.1, 7.7));
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

            // Slab fuzz: each star hovers a hashed hair off the plane, and
            // parVec turns that height into its exact apparent shift in
            // this pixel's plane frame. Clamped to stay sub-cell so the
            // 3x3 lookup never clips a shifted star. Gated on the uniform
            // (coherent branch): a flat disk skips the math entirely and
            // renders the old look bit for bit.
            vec2 hOff = vec2(0.0);
            if (uDiskThickness > 0.001) {
                float hh = (hash1(n + vec2(17.9, 61.3)) - 0.5) * 2.0;
                // Fuzz saturates at thickness 1: this fine lattice has no
                // sub-cell budget past that, so slider range above 1 goes
                // entirely into the floaters (which do have headroom).
                hOff = parVec * (hh * min(uDiskThickness, 1.0) * 0.004);
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
                    result.x = max(result.x, bright);
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
vec2 starField(vec2 p, float keep, vec2 parVec, float partLo, float partHi, float ang, vec3 pxCtl, float wantAll) {
    float lod = min(max(0.0, log2(1.0 / max(uZoom, 0.0001))), uMaxStarLod);
    float l0 = floor(lod);
    float f = lod - l0;
    float s0 = exp2(l0);
    vec2 a = starFieldLevel(p, s0, l0, keep, parVec, partLo, partHi, ang, pxCtl, wantAll);
    // The cross-fade weight f derives purely from uZoom, so this branch is
    // fully coherent; at rest (f = 0) it skips the second lattice level
    // entirely, halving the star pass. mix(a, b, 0) == a, so no visual
    // change where it fires.
    if (f < 0.001) return a;
    vec2 b = starFieldLevel(p, s0 * 2.0, l0 + 1.0, keep, parVec, partLo, partHi, ang, pxCtl, wantAll);
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
    return pow(clamp(1.0 - 1.0/max(r, 0.0001), 0.0, 1.0), 4.0);
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

float arm(float n, float aw, float wb, float wn, vec2 p){
    float t = atan(p.y, p.x);
    float r = length(p) + 1e-4;
    float rw = spacingWarp(r);
    return pow(1.0 - 0.15*sin((theta(rw,wb,wn)-t)*n), aw) * exp(-r*r) * exp(-0.07/r);
}

float armAngleMask(float n, float aw, float wb, float wn, vec2 p){
    float t = atan(p.y, p.x);
    float r = length(p) + 1e-4;
    float rw = spacingWarp(r);
    float angularFit = pow(1.0 - 0.15*sin((theta(rw,wb,wn)-t)*n), aw);
    float radialFade = exp(-r * 0.65) * exp(-0.07/r);
    // Outer taper: past r = 1.0 the arms dissolve into the disk instead of
    // trailing off as long solid ribbons. Exactly identity below r = 1.0 so
    // the inner spiral is untouched; beyond it a quadratic-exponent cutoff
    // collapses the tail, and since the star mask CUBES this value, the tail
    // fragments into sparse dimming dots well before the mask hits zero.
    float ex = max(r - 1.0, 0.0);
    radialFade *= exp(-ex * ex * 8.0);
    return angularFit * radialFade;
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
    vec2 pe = ps; pe.y -= 0.2;
    // uCoreGlowSpread scales the WIDTH of both glow gaussians (dividing
    // the exponent) with their peaks untouched -- reach and intensity are
    // independent controls. At 1.0 the multiplier is exactly 1: identity.
    float gInv = 1.0 / (uCoreGlowSpread * uCoreGlowSpread);
    float glow = exp(-dot(ps,ps)*1.2*gInv) + 0.5*exp(-dot(pe,pe)*12.0*gInv);
    float glowTerm = glow*(0.7+0.2*d+0.2*fbmabs(pd));
    return vec2(armTerm, glowTerm);
}

// Truncated fbmabs for the GLOW layer only: 6 octaves instead of 8. The
// drift feedback (p -= ... * r) only affects LATER octaves, so truncation
// removes exactly the two finest terms -- amplitude <= 1/64 + 1/128 at
// 0.2 weight inside a layer scaled by another ~0.14, i.e. far below one
// 8-bit step. The ridged fbmdust/fbmdisk stacks are NOT reducible this
// way (dropping an octave moves their ridge lines; measured up to
// 32/255) -- they stay at full octaves everywhere.
float fbmabsG(vec2 p) {
    float f = 1.0;
    float r = 0.0;
    for (int i = 0; i < 6; i++) {
        r += abs(noise(p*f))/f;
        f *= 2.0;
        p -= vec2(-0.01, 0.08)*r;
    }
    return r;
}

// The secondary GLOW layer's own smoke: identical to smokeMap except the
// fbmabs grain runs the truncated variant above -- the b layer lands in
// the frame scaled by 0.3 x 0.6 (boom) / 0.13 (normal), so the finest
// grain octaves sit below what 8-bit output can even represent.
float smokeMapGlow(vec2 ps, vec2 pd){
    float a = arm(uArmCount, 6.0, 0.7, uArmWinding, ps);
    float d = fbmdust(pd);
    float armTerm = a*(0.4+0.1*arm(uArmCount+1.0, 4.0, 0.7, uArmWinding, ps*m2))*(0.1+0.6*d+0.4*fbmdisk(pd));
    vec2 pe = ps; pe.y -= 0.2;
    float glow = exp(-dot(ps,ps)*1.2) + 0.5*exp(-dot(pe,pe)*12.0);
    float glowTerm = glow*(0.7+0.2*d+0.2*fbmabsG(pd));
    return max(armTerm, glowTerm);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = 2.0*fragCoord.xy/iResolution.xy - 1.0;
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
    // gaussian bulge, arm taper, corona, core glow) is sub-quantization
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
    bool inHole = length(p) <= uBlackHoleSize * mix(0.45, 0.85, uCoreMode);

    // Haze extinction during the deep dive: the smoke lingers around the
    // viewer well into the zoom (full until zoom 0.18) and only then
    // dissipates quickly, fully gone by 0.03 as the core takes over --
    // the reference ends black behind the star swarm. Deliberately
    // non-linear: rest and most of the dive see exactly the full haze.
    // Killing the haze also skips both smokeMap calls (the frame's
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
    // Corona: tight central bloom, its own slider. BOOM MODE ONLY, as it
    // always was -- the dive's visible zoom runs in normal colors (the
    // palette swap hides behind the fade), and at deep zoom this exp
    // covers most of the screen, so adding it to normal mode washes the
    // whole finale in bloom. Cheap single exp, computed unconditionally.
    float corona = uCorona * hazeMod * exp(-dot(pOval, pOval) * 25.0);
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
        gas = uGasClouds * band * breakup * (0.85 + 0.15 * n2) * cEnv
            * cloudVis * uHazePulse * 0.55;
    }
    // Stars. Flat path (uDiskThickness = 0): the original single-plane
    // field, bit for bit, zero extra cost. Thick path: the SAME arm and
    // bulge populations are dealt out across two exactly-shifted height
    // sheets each (partition hash -- no density change), with the arm
    // mask and disk falloff evaluated at every sheet's own FOOTPRINT so
    // stars keep tracing the arms they belong to. Arms stay a thin slab;
    // the bulge gets ~3x the height (it's the puffy spheroid); the sparse
    // floater layer scatters furthest. All uniform-gated -- coherent.
    float starsV;
    if (inHole) {
        starsV = 0.0;
    } else if (uDiskThickness > 0.001) {
        float hDisk  = uDiskThickness * 0.008;  // arm slab half-height
        float hBulge = uDiskThickness * 0.025;  // bulge spheroid half-height
        starsV = 0.0;
        for (int s = 0; s < 2; s++) {
            float sgn = (s == 0) ? 1.0 : -1.0;
            float lo  = (s == 0) ? 0.0 : 0.5;
            float hi  = lo + 0.5;
            // Arm sheet: footprint built in the unrotated frame (pBg) so
            // the oval warp stays screen-aligned, then rotated like p.
            vec2 aU = pBg - parVec * (sgn * hDisk);
            vec2 aOval = rotate(vec2(aU.x / ovA, aU.y * ovA), ang);
            vec2 aRot = rotate(aU, ang);
            float aMask = pow(armAngleMask(uArmCount, 6.0, 0.7, uArmWinding, aOval), 3.0);
            // Skip the lattice wherever the mask/falloff already caps the
            // contribution below the 1/255 dither floor -- most of the
            // frame. Radially/arm-shaped regions, so the branch stays
            // spatially coherent.
            if (aMask > 0.0005) {
                starsV = max(starsV, aMask * starField(aRot, 1.0, parRot, lo, hi, ang, pxCtl, 0.0).y * 1.5);
            }
            // Bulge sheet: gaussian falloff drives PRESENCE at the sheet
            // footprint -- near-flat over the core, collapsing hard with
            // radius so the diffuse scatter stays concentrated instead of
            // trailing far outside the disk; 0.8x keeps arms dominant.
            vec2 bRot = rotate(pBg - parVec * (sgn * hBulge), ang);
            float bKeep = min(uBulge * 2.4 * exp(-dot(bRot, bRot) * 7.0), 1.0);
            if (bKeep > 0.003) {
                starsV = max(starsV, starField(bRot, bKeep, parRot, lo, hi, ang, pxCtl, 0.0).y * 1.5 * 0.8);
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
        float starMask = pow(armAngleMask(uArmCount, 6.0, 0.7, uArmWinding, pOval), 3.0);
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
        vec2 sf = starField(p, bulgeKeep, parRot, 0.0, 1.0, ang, pxCtl, 1.0);
        starsV = max(starMask * sf.x * 1.5, sf.y * 1.5 * 0.8);
    }

    // groundVis gates every galaxy-body term so the region beyond the
    // horizon (see camDenom above) reads as clean black/background instead
    // of the saturated fallback coordinate.
    float k  = uCompactness * smoke * groundVis;              // smoky spiral body
    float sV = uCompactness * starsV * groundVis;             // star layer (normal mode)
    float starsB = uCompactness * starsV * 0.8 * groundVis;   // star brightness (boom mode)
    bool glowOn = hazeMod > 0.001 && !inHole && uGlowLayer > 0.001;
    float b = (glowOn ? uGlowLayer * hazeMod * 0.3 * smokeMapGlow(pOval*m2, p*m2) : 0.0) * groundVis; // secondary nebula glow layer


    float dist = length(pOval); // structural radius: tints/glows follow the oval
    float rCore = length(p);    // true radius: the core itself stays round

    // --- COMPUTE BOOM MODE ---
    // Dual-tone spiral: the inner region takes uCenterColor and blends into
    // uArmColor with radius, so the spiral body itself is two-toned. The
    // soft secondary glow (the b layer) + corona are the nebula, tinted by
    // uOuterHazeColor.
    // Center tint fades out on a gaussian -- no visible edge, unlike a
    // smoothstep band which reads as a drawn circle. uCenterSpread sets
    // how far the tint reaches (weight = exp(-d^2/spread^2)).
    float centerW = exp(-(dist * dist) / (uCenterSpread * uCenterSpread));
    vec3 spiralHue = mix(uArmColor, uCenterColor, centerW);
    vec3 boomCol = spiralHue * (k * 0.8 + k * k * 0.2) +
                   uStarColor * starsB +
                   (uOuterHazeColor * (b * 0.6));

    vec3 boomLayer = clamp(boomCol, 0.0, 1.6);
    boomLayer += corona * uOuterHazeColor;

    // --- COMPUTE NORMAL MODE ---
    // Exact decomposition of the original grayscale formula
    //   lum = (0.2*kA^2 + 0.7*kA + 0.4*b) / 3,  kA = k + sV
    // split by source: expanding kA^2 = k^2 + 2*k*sV + sV^2, the body keeps
    // its own square, the star term absorbs the cross term (star-on-arm
    // pixels lean toward the star color), and the glow layer stands alone.
    // With all four normal colors equal the three terms sum back to exactly
    // lum * tint -- the old look, bit for bit -- while different colors
    // recolor only their own element.
    vec3 nHue = mix(uNormalArmColor, uNormalCenterColor, centerW);
    vec3 normalCol = nHue              * ((0.2 * k * k + 0.7 * k) / 3.0)
                   + uNormalStarColor  * ((0.2 * (sV * sV + 2.0 * k * sV) + 0.7 * sV) / 3.0)
                   + uNormalHazeColor  * (0.4 * b / 3.0);
    vec3 normalLayer = clamp(normalCol, 0.0, 1.6);

    // Gas-cloud gauze, tinted like the nebula in each mode. Added before
    // the core mix so the hole / white core still punches through, and
    // additively over the body so stars shine through the banks.
    float gasG = gas * groundVis;
    boomLayer   += uOuterHazeColor  * gasG;
    normalLayer += uNormalHazeColor * gasG * 0.85;

    // --- CORE (both modes): uCoreMode 0 = black hole, 1 = bright white core
    // Black hole has no rim glow and a wide soft edge, so surrounding haze
    // and stars feather gently into the void; white core keeps a tight edge.
    float edgeIn  = mix(0.45, 0.85, uCoreMode);
    float edgeOut = mix(1.60, 1.15, uCoreMode);
    float coreMask = 1.0 - smoothstep(uBlackHoleSize*edgeIn, uBlackHoleSize*edgeOut, rCore);
    vec3 coreCol = mix(vec3(0.0), vec3(1.05, 1.05, 1.12), uCoreMode);
    float rim = exp(-pow((rCore - uBlackHoleSize*1.25)/(uBlackHoleSize*0.5), 2.0));
    // rim glow only for the white core (its halo); zero in black-hole mode
    float rimAmt = uCoreMode * 0.30;
    // extra bloom around the white core so it reads as glowing, not flat
    float coreGlow = uCoreMode * exp(-dot(p,p) / (uBlackHoleSize*uBlackHoleSize) * 1.5) * 0.35;

    normalLayer = mix(normalLayer, coreCol, coreMask);
    normalLayer += rim * rimAmt * uNormalStarColor;
    normalLayer += coreGlow;

    boomLayer = mix(boomLayer, coreCol, coreMask);
    boomLayer += rim * rimAmt * vec3(0.9, 0.85, 1.0);
    boomLayer += coreGlow;

    // --- MIX MODES ---
    vec3 finalCol = mix(normalLayer, boomLayer, uColorTransition);

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
