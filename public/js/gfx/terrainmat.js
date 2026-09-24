import * as THREE from 'three';
import { surface } from './surfaces.js';
import { injectGlobals } from './atmosphere.js';

// The ground's material: four surfaces blended per vertex (a `splat`
// attribute: grass, dirt, rock, sand), each with its own colour, normal and
// roughness. Grass takes its colour from the vertex colour (lush, dry, sun
// bleached), so the valley keeps its patchwork. Grass is sampled at two
// scales so it does not visibly tile; rock is projected from the side on
// steep slopes, so cliffs are not smeared.

export function terrainMaterial() {
  const grass = surface('grass', '#b4b8a8');
  const dirt = surface('dirt', '#8a6a48');
  const rock = surface('rock', '#8e847a');
  const sand = surface('sand', '#cbb489');
  const m = new THREE.MeshStandardMaterial({
    map: grass.map,
    normalMap: grass.normalMap,
    roughnessMap: grass.roughnessMap,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  const u = {
    tDirt: { value: dirt.map }, tRock: { value: rock.map }, tSand: { value: sand.map },
    nDirt: { value: dirt.normalMap }, nRock: { value: rock.normalMap }, nSand: { value: sand.normalMap },
    rDirt: { value: dirt.roughnessMap }, rRock: { value: rock.roughnessMap }, rSand: { value: sand.roughnessMap },
    grassAvg: { value: grass.avg.clone() },
  };
  m.onBeforeCompile = (shader) => {
    injectGlobals(shader);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vTerrW;
varying vec3 vTerrN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSplat = splat;
vTerrW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTerrN = normalize( mat3( modelMatrix ) * objectNormal );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tDirt; uniform sampler2D tRock; uniform sampler2D tSand;
uniform sampler2D nDirt; uniform sampler2D nRock; uniform sampler2D nSand;
uniform sampler2D rDirt; uniform sampler2D rRock; uniform sampler2D rSand;
uniform vec3 grassAvg;
varying vec4 vSplat;
varying vec3 vTerrW;
varying vec3 vTerrN;`)
      .replace('#include <map_fragment>', `
vec2 tuv = vMapUv;
vec3 tan3 = abs( vTerrN );
vec2 ruv = tan3.y > 0.72 ? vTerrW.xz / 6.0 : ( tan3.x > tan3.z ? vTerrW.zy / 6.0 : vTerrW.xy / 6.0 );
vec4 g1 = texture2D( map, tuv );
vec4 g2 = texture2D( map, tuv * 0.23 + 0.37 );
vec3 grassC = mix( g1.rgb, g2.rgb, 0.45 ) / max( grassAvg, vec3( 1e-3 ) ) * vColor;
vec3 dirtC = texture2D( tDirt, tuv ).rgb;
vec3 rockC = texture2D( tRock, ruv ).rgb;
vec3 sandC = texture2D( tSand, tuv ).rgb;
// Crisper edges between surfaces, broken up by the grass's own texture.
vec4 tw = max( vSplat + ( dot( g1.rgb, vec3( 0.33 ) ) - 0.25 ) * vec4( 0.0, 0.5, 0.5, 0.3 ) * step( 0.02, vSplat ), 0.0 );
tw = pow( tw, vec4( 1.6 ) );
tw /= max( tw.x + tw.y + tw.z + tw.w, 1e-3 );
diffuseColor.rgb *= grassC * tw.x + dirtC * tw.y + rockC * tw.z + sandC * tw.w;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness * ( texture2D( roughnessMap, tuv ).g * tw.x + texture2D( rDirt, tuv ).g * tw.y
  + texture2D( rRock, ruv ).g * tw.z + texture2D( rSand, tuv ).g * tw.w );`)
      .replace('#include <normal_fragment_maps>', `
vec3 mapN = ( texture2D( normalMap, tuv ).xyz * 2.0 - 1.0 ) * tw.x
  + ( texture2D( nDirt, tuv ).xyz * 2.0 - 1.0 ) * tw.y
  + ( texture2D( nRock, ruv ).xyz * 2.0 - 1.0 ) * tw.z
  + ( texture2D( nSand, tuv ).xyz * 2.0 - 1.0 ) * tw.w;
mapN.xy *= normalScale;
normal = normalize( tbn * mapN );`);
  };
  m.customProgramCacheKey = () => 'terrain-splat';
  return m;
}
