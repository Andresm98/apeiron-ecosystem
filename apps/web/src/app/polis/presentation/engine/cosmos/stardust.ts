import * as THREE from 'three';
import { PALETTE } from '../../../domain/atmosphere';

/** Volumen que envuelve a la cámara: las partículas se repliegan dentro al moverse (parecen llenar toda la escena). */
const BOX = new THREE.Vector3(180, 70, 180);

const VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uPixelRatio;
attribute float aSeed;
varying float vAlpha;
varying vec3 vColor;
uniform vec3 uCyan;
uniform vec3 uViolet;
uniform vec3 uWarm;

void main() {
  // Deriva lenta y ondulante; después, repliegue dentro de la caja centrada en la cámara.
  vec3 drift = vec3(sin(uTime * 0.05 + aSeed * 6.0), 0.35 * sin(uTime * 0.11 + aSeed * 13.0), cos(uTime * 0.04 + aSeed * 9.0)) * (2.0 + aSeed * 3.0);
  vec3 p = position + drift + vec3(0.0, uTime * (0.15 + aSeed * 0.25), 0.0);
  p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // Lejos se desvanece (antes del borde de la caja, para que el repliegue no se vea).
  float edge = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(p.xz - uCenter.xz));
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.5) + aSeed * 40.0);
  vAlpha = edge * twinkle * smoothstep(0.5, 3.0, dist);
  vColor = aSeed < 0.6 ? mix(uCyan, uViolet, aSeed / 0.6) : mix(uViolet, uWarm, (aSeed - 0.6) / 0.4);
  gl_PointSize = clamp((0.7 + aSeed * 1.6) * uPixelRatio * (55.0 / max(dist, 1.0)), 1.0, 7.0 * uPixelRatio); // polvo fino, no bokeh
}
`;

const FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float glow = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * (0.6 + 1.6 * glow * glow), glow * vAlpha);
}
`;

/** Polvo cósmico flotando en todo el volumen de la escena (`THREE.Points`, aditivo, un draw call). */
export class Stardust {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(count: number) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    let seed = 1234;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      positions.set([(rand() - 0.5) * BOX.x, (rand() - 0.5) * BOX.y, (rand() - 0.5) * BOX.z], i * 3);
      seeds[i] = rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uPixelRatio: { value: 1 },
        uCyan: { value: new THREE.Color(PALETTE.energy).multiplyScalar(0.9) },
        uViolet: { value: new THREE.Color(PALETTE.energyViolet).multiplyScalar(0.8) },
        uWarm: { value: new THREE.Color(PALETTE.lamp).multiplyScalar(0.8) },
      },
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(t: number, camera: THREE.Camera, pixelRatio: number): void {
    this.material.uniforms['uTime']!.value = t;
    // El centro de la caja va un poco por delante de la cámara: el polvo rodea lo que se mira.
    const center = this.material.uniforms['uCenter']!.value as THREE.Vector3;
    center.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30));
    this.material.uniforms['uPixelRatio']!.value = pixelRatio;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
