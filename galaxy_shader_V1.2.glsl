// Neutral-palette spiral galaxy, tilted-oval view, with a central black hole.
// Arm/dust/disk math adapted from S.Guillitte's galaxy shader
// (CC BY-NC-SA 3.0) - morphology reference:
// http://iopscience.iop.org/0004-637X/783/2/138/pdf/0004-637X_783_2_138.pdf
// Shadertoy-compatible: paste directly into Shadertoy's Image tab.

uniform float uZoom;
uniform float uFade;

// Sandbox controls
uniform float uColorTransition;
uniform float uArmCount;
uniform float uArmWinding;
uniform float uArmSpacing;      // radial spacing between arm turns without
                                // changing how many there are; see spacingWarp().
                                // >1 opens the center, <1 opens the rim. 1.0 = original.
uniform float uHaze;            // nebula/smoke visibility; 0 = hidden
                                // (clean starfield), 1 = full. Stars are
                                // independent of this.
uniform float uOvalness;        // intrinsic elongation (Sa/Sb); see the
                                // ovalness frames built in mainImage.
                                // 1.0 = round (original).
uniform float uSquash;
uniform float uCompactness;
uniform float uStarDensity;
uniform float uTwinkleFraction; // 0..1: fraction of stars that twinkle
uniform float uTwinkleSpeed;    // pulse rate; independent of rotation speed
uniform float uTwinkleTime;     // wall-clock seconds, supplied by the host app.
                                // MUST advance at real-time even when rotation
                                // is stopped or iTime is scaled (e.g. dive 5x).
uniform float uPxSize;          // p-space size of one screen pixel, supplied by
                                // host: 4.0*zoom*max(1/width, 1/(height*squash))
uniform float uRotSpeed;        // spin speed
uniform float uCoreMode; // 0.0 = black hole, 1.0 = bright white core
uniform float uBlackHoleSize;
uniform vec3 uCenterColor;
uniform vec3 uArmColor;
uniform vec3 uOuterHazeColor;   // nebula glow (b layer + corona)
uniform vec3 uStarColor;        // stars, independent of the smoke tint
uniform float uCenterSpread;    // how far the center tint reaches (gaussian)

const vec2 m = vec2(2.0, 12.0);
const mat2 m2 = mat2(0.8, 0.6, -0.6, 0.8);

float noise(in vec2 p) {
    float res = 0.0;
    for (int i = 0; i < 4; i++) {
        p = m2 * p * 2.0 + 0.6;
        res += sin(p.x + sin(2.0 * p.y));
    }
    return res / 4.0;
}

// Simple 2D hash returning [0,1) — deterministic, no sin aliasing
float hash1(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// One star grid at a given LOD scale. lvlScale multiplies the grid so
// star spacing stays roughly constant on screen as the camera dives;
// BASE_R shrinks by the same factor so star size tracks spacing.
float starFieldLevel(vec2 p, float lvlScale, float seed) {
    float GRID = (8.0 + 18.0 * uStarDensity) * lvlScale;
    // Energy-conserving anti-aliasing: BASE_R is the intended star size.
    // If the screen can't resolve it (sub-pixel), the star is drawn just
    // large enough (~1.2 px) but dimmed by the area ratio, so it reads as
    // the same small point of light -- no size inflation, no shimmer.
    float BASE_R = 0.009 / lvlScale;
    float radius = max(BASE_R, uPxSize * 1.2);
    float atten = (BASE_R / radius) * (BASE_R / radius);
    vec2 cell = floor(p * GRID);
    float result = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 n = cell + vec2(float(dx), float(dy)) + vec2(seed * 57.0, seed * 113.0);

            float hx = hash1(n);
            float hy = hash1(n + vec2(31.41, 27.18));
            vec2 starPos = (n - vec2(seed * 57.0, seed * 113.0) + vec2(hx, hy)) / GRID;

            float dist = length(p - starPos);

            if (dist < radius) {
                float brightness = pow(1.0 - dist / radius, 2.5) * atten;

                float h = hash1(n + vec2(99.1, 23.7));
                float twinkle = 1.0;
                // Exactly uTwinkleFraction of stars twinkle, on their own
                // clock (uTwinkleTime) so rotation speed has no effect.
                if (h > 1.0 - uTwinkleFraction) {
                    float pulse = abs(sin(uTwinkleTime * uTwinkleSpeed + h * 100.0));
                    twinkle = mix(0.05, 3.0, pulse);
                }

                result = max(result, brightness * twinkle);
            }
        }
    }
    return result;
}

// Zoom-adaptive starfield: as the camera dives (uZoom -> 0) blend between
// successive power-of-two star grids, so on-screen star size and density
// stay roughly constant -- flying THROUGH a starfield, not magnifying one.
// At uZoom = 1 this is exactly one grid at the original scale.
float starField(vec2 p) {
    float lod = max(0.0, log2(1.0 / max(uZoom, 0.0001)));
    float l0 = floor(lod);
    float f = lod - l0;
    float s0 = exp2(l0);
    float a = starFieldLevel(p, s0, l0);
    float b = starFieldLevel(p, s0 * 2.0, l0 + 1.0);
    return mix(a, b, f);
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

// Like arm() but WITHOUT the exp(-r*r) radial falloff — used to place stars
// all the way to the tip of the arm, with only a gentle outer fade.
float armAngleMask(float n, float aw, float wb, float wn, vec2 p){
    float t = atan(p.y, p.x);
    float r = length(p) + 1e-4;
    float rw = spacingWarp(r);
    float angularFit = pow(1.0 - 0.15*sin((theta(rw,wb,wn)-t)*n), aw);
    // Gentler radial fade so stars persist to 4/5ths of the arm length
    float radialFade = exp(-r * 0.65) * exp(-0.07/r);
    return angularFit * radialFade;
}

// Smoky galaxy body only: arms + dust + disk. Stars are computed
// separately in mainImage so they can carry their own color (uStarColor)
// instead of inheriting the smoke tint.
// Takes two coordinates: ps drives the arm STRUCTURE (may be elliptical)
// and pd drives the texture DETAIL (dust/disk noise) which stays round,
// so ovalness never smears the grain like a stretched image. With
// uOvalness = 1 both are identical.
float smokeMap(vec2 ps, vec2 pd){
    float a = arm(uArmCount, 6.0, 0.7, uArmWinding, ps);
    float d = fbmdust(pd);
    return a*(0.4+0.1*arm(uArmCount+1.0, 4.0, 0.7, uArmWinding, ps*m2))*(0.1+0.6*d+0.4*fbmdisk(pd));
}

vec2 rotate(in vec2 p, in float t){
    return p * cos(-t) + vec2(p.y, -p.x) * sin(-t);
}

// A handful of floating background stars scattered across the whole frame,
// independent of the spiral arms/density slider. Almost all grid cells are
// empty (present threshold is high) so only a couple of stars show up per
// screen, each twinkling on its own clock like a real distant star.
float bgStarField(vec2 p) {
    float GRID = 2.2;
    float BASE_R = 0.007;
    float radius = max(BASE_R, uPxSize * 1.2);
    float atten = (BASE_R / radius) * (BASE_R / radius);
    vec2 cell = floor(p * GRID);
    float result = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 n = cell + vec2(float(dx), float(dy));

            float present = step(0.93, hash1(n + vec2(91.7, 5.3)));
            if (present < 0.5) continue;

            float hx = hash1(n + vec2(7.0, 3.0));
            float hy = hash1(n + vec2(31.41, 27.18) + 7.0);
            vec2 starPos = (n + vec2(hx, hy)) / GRID;
            float dist = length(p - starPos);

            if (dist < radius) {
                float brightness = pow(1.0 - dist / radius, 2.5) * atten;
                float h = hash1(n + vec2(99.1, 23.7));
                float pulse = abs(sin(uTwinkleTime * uTwinkleSpeed * 0.5 + h * 100.0));
                float twinkle = mix(0.15, 1.6, pulse);
                result = max(result, brightness * twinkle);
            }
        }
    }
    return result;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = 2.0*fragCoord.xy/iResolution.xy - 1.0;
    p.x = -p.x; // Flip horizontally to reverse spiral and rotation
    p *= 2.0 * uZoom;

    // Flatten the vertical axis to simulate a steep-but-not-fully-top-down
    // viewing angle (tilted oval) instead of a symmetric top-down view.
    // Unsquashing BEFORE rotation keeps the oval's on-screen orientation
    // fixed while the spiral pattern itself still spins underneath it.
    p.y /= uSquash;

    // Sampled pre-rotation so the background field stays fixed in place
    // while the spiral spins underneath it, instead of orbiting with it.
    vec2 pBg = p;

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

    // uHaze scales the smoky nebula body (0 = hidden, 1 = full). Stars are
    // independent, so hiding the haze leaves a clean starfield. Gate is on
    // a uniform, so it's fully coherent -- no per-pixel divergence.
    float smoke = uHaze > 0.001 ? uHaze * smokeMap(pOval, p) : 0.0;
    // Oval arm mask decides WHERE stars live; the round starField decides
    // WHAT they look like -- so stars trace the oval arms as round dots.
    float starMask = pow(armAngleMask(uArmCount, 6.0, 0.7, uArmWinding, pOval), 3.0);
    float starsV = starMask * starField(p) * 1.5;

    float k  = uCompactness * smoke;              // smoky spiral body
    float kA = uCompactness * (smoke + starsV);   // body + stars (normal mode)
    float starsB = uCompactness * starsV * 0.8;   // star brightness (boom mode)
    float b = uHaze > 0.001 ? uHaze * 0.3 * smokeMap(pOval*m2, p*m2) : 0.0; // pure nebula glow layer

    // Distant background field: a scatter of fixed floating stars, faded
    // in only beyond the galaxy body so it reads as depth behind the
    // spiral rather than competing with it.
    float bgMask = smoothstep(0.85, 1.7, length(pBg));
    float bgStars = bgStarField(pBg) * bgMask;

    // Neutral / grayscale recoloring: keep the same channel weighting and
    // nonlinear contrast structure as the original (R = r*k^2, G = r*k,
    // B = k*.5+b*.4) but average them into one luminance value instead of
    // leaving them as separate red/green/blue -- this preserves all of the
    // original's brightness detail and contrast, just without the hue.
    // (Original also added a constant +0.4 to B; removed here so distant
    // background pixels fall all the way to true black.)
    float R = 0.2 * kA * kA;
    float G = 0.2 * kA;
    float B = kA * 0.5 + b * 0.4;
    float lum = (R + G + B) / 3.0;

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

    float corona = exp(-dot(pOval,pOval)*25.0);
    boomLayer += corona * uOuterHazeColor * uHaze;

    // --- COMPUTE NORMAL MODE ---
    vec3 normalLayer = clamp(vec3(lum), 0.0, 1.6) * vec3(0.86, 0.89, 0.95);

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
    normalLayer += rim * rimAmt * vec3(0.85, 0.88, 0.95);
    normalLayer += coreGlow;

    boomLayer = mix(boomLayer, coreCol, coreMask);
    boomLayer += rim * rimAmt * vec3(0.9, 0.85, 1.0);
    boomLayer += coreGlow;

    // Background field stars, added after the core so they never wash out
    // the black hole/white core itself.
    normalLayer += bgStars * vec3(0.85, 0.88, 0.95);
    boomLayer += bgStars * uStarColor;

    // --- MIX MODES ---
    vec3 finalCol = mix(normalLayer, boomLayer, uColorTransition);

    finalCol = pow(clamp(finalCol, 0.0, 1.0), vec3(0.9));
    finalCol *= uFade;

    fragColor = vec4(finalCol, 1.0);
}
