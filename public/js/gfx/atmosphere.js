import * as THREE from 'three';

// The sky and the air: a physically based daylight sky (Preetham) with
// drifting clouds lit by the sun, stars and the moon at night, and fog that
// thickens towards the ground and glows towards the sun, so the far hills
// melt into the same haze the sky has at the horizon.

// ------------------------------------------------------------------ fog
//
// three.js fog is replaced everywhere (every built-in material) with height
// fog: dense in the valley, thinning with altitude, tinted towards the sun.
// The extra values are shared uniforms, handed to every material as it is
// compiled, so changing them here changes them for the whole world.

export const FOG = {
  fogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  fogSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
  fogFalloff: { value: 0.006 },
  fogBase: { value: 0 },
  fogEnd: { value: 900 },
};

/** Adds the shared uniforms to a shader being compiled (every material calls this). */
export function injectGlobals(shader) {
  Object.assign(shader.uniforms, FOG);
}

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
  C.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform float fogFalloff;
  uniform float fogBase;
  uniform float fogEnd;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    float fogRY = fogRay.y * fogFalloff;
    // Density falls off exponentially with height: integrate it along the ray.
    float fogK = abs( fogRY ) > 1e-4 ? ( 1.0 - exp( - fogRY ) ) / fogRY : 1.0;
    float fogOptical = fogDensity * exp( - fogFalloff * ( cameraPosition.y - fogBase ) ) * fogK * fogDist;
    // ...and everything fades out fully before the far plane cuts it off.
    float fogFactor = max( 1.0 - exp( - fogOptical ), smoothstep( fogEnd * 0.72, fogEnd * 0.97, fogDist ) );
    float fogSun = pow( max( dot( fogRay / max( fogDist, 1e-3 ), fogSunDir ), 0.0 ), 12.0 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, fogSunColor, fogSun ), fogFactor );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;
  // Every material gets the shared fog uniforms when it is compiled. A
  // material that needs its own onBeforeCompile calls injectGlobals() too.
  THREE.Material.prototype.onBeforeCompile = function onBeforeCompile(shader) { injectGlobals(shader); };
}

// ------------------------------------------------------------------ sky

const SKY_VERT = /* glsl */`
uniform vec3 sunDir;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
varying vec3 vWorldPosition;
varying float vSunE;
varying vec3 vBetaR;
varying vec3 vBetaM;
const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w;
  vSunE = sunIntensity( sunDir.y );
  vBetaR = totalRayleigh * rayleigh;
  vBetaM = 0.434 * ( 0.2 * turbidity * 10E-18 ) * MieConst * mieCoefficient;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float mieDirectionalG;
uniform float skyScale;
uniform float night;
uniform float dusk;
uniform float grey;
uniform vec3 overcast;
uniform vec3 haze;
uniform vec3 hazeSun;
uniform vec3 ground;
uniform float envMode;
uniform float cloudCover;
uniform float cloudTime;
uniform float cloudsOn;
uniform vec3 cloudSun;
uniform vec3 cloudShade;
varying vec3 vWorldPosition;
varying float vSunE;
varying vec3 vBetaR;
varying vec3 vBetaM;
const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99992;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + cosTheta * cosTheta ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = g * g;
  return ONE_OVER_FOURPI * ( 1.0 - g2 ) / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
}
float hash2( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float hash3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash2( i ), hash2( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hash2( i + vec2( 0.0, 1.0 ) ), hash2( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
  float a = 0.5; float s = 0.0;
  for ( int i = 0; i < 5; i++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 1.7, 9.2 ); a *= 0.5; }
  return s;
}

void main() {
  vec3 dir = normalize( vWorldPosition - cameraPosition );
  float dy = dir.y;

  // Daylight scattering (Preetham), for the sky above the horizon.
  float zenithAngle = acos( max( 0.0, dy ) );
  float inv = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  vec3 Fex = exp( -( vBetaR * rayleighZenithLength * inv + vBetaM * mieZenithLength * inv ) );
  float cosTheta = dot( dir, sunDir );
  vec3 betaRTheta = vBetaR * rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaMTheta = vBetaM * hgPhase( cosTheta, mieDirectionalG );
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ), clamp( pow( 1.0 - sunDir.y, 5.0 ), 0.0, 1.0 ) );
  float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00004, cosTheta );
  // Linear light, scaled so the blue sky is about as bright as sunlit ground,
  // the way it is outside.
  vec3 col = ( Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) ) * skyScale;
  vec3 sun = vSunE * 19000.0 * Fex * sundisk * 0.04 * skyScale;

  // Sunrise and sunset: a warm glow round the low sun, a pink band opposite
  // it, and the sky overhead going a deep blue.
  float low = 1.0 - smoothstep( 0.0, 0.45, dy );
  col += hazeSun * 0.55 * pow( max( cosTheta, 0.0 ), 3.0 ) * low * dusk;
  col += vec3( 0.2, 0.09, 0.13 ) * pow( max( -cosTheta, 0.0 ), 1.5 ) * ( 1.0 - smoothstep( 0.0, 0.3, dy ) ) * dusk;
  col = mix( col, vec3( 0.025, 0.045, 0.1 ), dusk * 0.55 * smoothstep( 0.15, 0.8, dy ) );

  // Night: a deep blue glow, brighter low down, stars and the moon.
  col += night * ( vec3( 0.0035, 0.0055, 0.014 ) + vec3( 0.008, 0.01, 0.018 ) * pow( 1.0 - max( dy, 0.0 ), 4.0 ) );
  if ( dy > 0.0 && night > 0.01 ) {
    vec3 sp = dir * 110.0;
    vec3 cell = floor( sp );
    float h = hash3( cell );
    if ( h > 0.985 ) {
      vec3 f = fract( sp ) - 0.5;
      float tw = 0.7 + 0.3 * sin( cloudTime * 3.0 + h * 400.0 );
      col += vec3( 0.9, 0.95, 1.0 ) * smoothstep( 0.16, 0.0, length( f ) ) * ( h - 0.985 ) * 60.0 * tw * night * ( 1.0 - grey ) * smoothstep( 0.0, 0.2, dy );
    }
  }
  float md = dot( dir, moonDir );
  vec3 moon = vec3( 0.0 );
  if ( md > 0.9995 ) moon = vec3( 1.6, 1.7, 1.9 ) * smoothstep( 0.9995, 0.99965, md );
  col += vec3( 0.03, 0.035, 0.05 ) * pow( max( md, 0.0 ), 300.0 ) * night;

  // Clouds on a layer 1.5 km up, drifting on the wind, lit from the sun's side.
  float cloud = 0.0;
  if ( cloudsOn > 0.5 && dy > 0.0 ) {
    vec2 p = ( cameraPosition.xz + dir.xz * ( 1500.0 / max( dy, 0.03 ) ) ) * 0.00042 + vec2( cloudTime * 0.0035, cloudTime * 0.0012 );
    float n = fbm( p );
    float edge = 0.64 - cloudCover * 0.46;
    cloud = smoothstep( edge, edge + 0.26, n ) * smoothstep( 0.0, 0.16, dy );
    float n2 = fbm( p + sunDir.xz * 0.05 );
    float lit = clamp( 0.55 + ( n - n2 ) * 4.0, 0.0, 1.0 );
    vec3 cc = cloudShade + cloudSun * lit;
    cc += cloudSun * pow( max( cosTheta, 0.0 ), 10.0 ) * ( 1.0 - cloud ) * 1.5;
    col = mix( col, cc, cloud * 0.97 );
  }
  sun *= 1.0 - cloud;
  moon *= 1.0 - cloud;

  // Overcast: a flat grey lid, lighter towards the top.
  col = mix( col, overcast * ( 0.85 + 0.25 * max( dy, 0.0 ) ), grey );
  col += ( sun + moon ) * ( 1.0 - grey );

  // The horizon melts into the same haze as the fog.
  vec3 hz = mix( haze, hazeSun, pow( max( cosTheta, 0.0 ), 12.0 ) );
  col = mix( col, hz, 1.0 - smoothstep( 0.0, 0.14, dy ) );
  if ( dy < 0.0 ) col = mix( hz, ground, envMode * smoothstep( 0.0, -0.12, dy ) );

  gl_FragColor = vec4( min( col, vec3( 64.0 ) ), 1.0 );
}`;

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Sky',
    uniforms: {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      turbidity: { value: 2.2 },
      rayleigh: { value: 2.0 },
      mieCoefficient: { value: 0.006 },
      mieDirectionalG: { value: 0.8 },
      skyScale: { value: 0.075 },
      night: { value: 0 },
      dusk: { value: 0 },
      grey: { value: 0 },
      overcast: { value: new THREE.Color(0.5, 0.52, 0.56) },
      haze: { value: new THREE.Color(0.6, 0.66, 0.74) },
      hazeSun: { value: new THREE.Color(0.9, 0.8, 0.6) },
      ground: { value: new THREE.Color(0.12, 0.11, 0.09) },
      envMode: { value: 0 },
      cloudCover: { value: 0.35 },
      cloudTime: { value: 0 },
      cloudsOn: { value: 1 },
      cloudSun: { value: new THREE.Color(1, 1, 1) },
      cloudShade: { value: new THREE.Color(0.5, 0.55, 0.65) },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// ------------------------------------------------------------------ colours
//
// What the air looks like for a given sun height, in the same units the
// scene is lit in: blue-white haze by day, amber at sunrise and sunset, a
// dark blue at night. Overcast pulls everything towards grey.

const KEYS = [
  // sun height (y of the unit vector), haze, haze towards the sun
  [-0.3, [0.010, 0.014, 0.028], [0.012, 0.016, 0.03]],
  [-0.06, [0.03, 0.03, 0.06], [0.12, 0.06, 0.07]],
  [0.02, [0.34, 0.24, 0.22], [0.95, 0.46, 0.2]],
  [0.12, [0.3, 0.3, 0.34], [0.8, 0.6, 0.38]],
  [0.35, [0.34, 0.42, 0.52], [0.66, 0.64, 0.56]],
  [1.0, [0.42, 0.54, 0.66], [0.66, 0.7, 0.68]],
];

export function hazeAt(sunY, grey, outHaze, outSun) {
  let i = 0;
  while (i < KEYS.length - 2 && sunY > KEYS[i + 1][0]) i++;
  const [y0, h0, s0] = KEYS[i];
  const [y1, h1, s1] = KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (sunY - y0) / (y1 - y0)));
  outHaze.setRGB(h0[0] + (h1[0] - h0[0]) * k, h0[1] + (h1[1] - h0[1]) * k, h0[2] + (h1[2] - h0[2]) * k);
  outSun.setRGB(s0[0] + (s1[0] - s0[0]) * k, s0[1] + (s1[1] - s0[1]) * k, s0[2] + (s1[2] - s0[2]) * k);
  // Overcast: grey, a little darker the heavier it is.
  const lum = outHaze.r * 0.3 + outHaze.g * 0.59 + outHaze.b * 0.11;
  const g = lum * (1 - grey * 0.35);
  outHaze.lerp(new THREE.Color(g * 0.95, g, g * 1.06), grey);
  outSun.lerp(outHaze, grey * 0.9);
}

/** Sunlight colour: white at noon, amber low down, red as it sets. */
export function sunColorAt(sunY, out) {
  // Through more air when low: first amber, then deep orange as it sets.
  const e = Math.min(1, Math.max(0, sunY * 3.2));
  const k = e * e * (3 - 2 * e);
  out.setRGB(1, 0.42 + 0.56 * k, 0.16 + 0.76 * k);
  return out;
}
