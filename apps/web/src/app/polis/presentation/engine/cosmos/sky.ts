import * as THREE from 'three';
import { PALETTE } from '../../../domain/atmosphere';

const SKY_RADIUS = 2000;
const CONSTELLATION_RADIUS = 1900;
const METEORS = 3;

/**
 * Cielo procedural (capa 0, ADR-013): nebulosas FBM en una banda galáctica, dos capas de estrellas con parpadeo,
 * la luna y un horizonte que se funde con la niebla. Un solo draw call, sin texturas; la esfera sigue a la cámara.
 * Las estrellas brillantes salen en HDR (> 1) para que el bloom las haga titilar.
 */
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // siempre en el plano lejano
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uVoid;
uniform vec3 uFog;
uniform vec3 uViolet;
uniform vec3 uBlue;
uniform vec3 uOchre;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uStarDensity;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    a *= 0.5;
  }
  return v;
}

// Una capa de estrellas: una celda 3D por dirección, como mucho una estrella por celda.
vec3 stars(vec3 dir, float density, float threshold, float size) {
  vec3 p = dir * density;
  vec3 cell = floor(p);
  vec3 local = fract(p) - 0.5;
  float h = hash(cell);
  if (h < threshold) return vec3(0.0);
  vec3 offset = vec3(hash(cell + 11.0), hash(cell + 23.0), hash(cell + 37.0)) - 0.5;
  float d = length(local - offset * 0.6);
  float core = smoothstep(size, 0.0, d);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.0 + 3.0 * hash(cell + 5.0)) + h * 80.0);
  float k = (h - threshold) / (1.0 - threshold);
  vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.65), hash(cell + 3.0));
  return tint * core * twinkle * (0.6 + 2.6 * k * k);
}

void main() {
  vec3 dir = normalize(vDir);
  // Banda galáctica inclinada: allí se concentran nebulosa y estrellas.
  vec3 bandNormal = normalize(vec3(0.35, 0.82, -0.45));
  float band = exp(-pow(dot(dir, bandNormal) / 0.42, 2.0));
  float n1 = fbm(dir * 2.4 + vec3(0.0, 0.0, uTime * 0.004));
  float n2 = fbm(dir * 5.1 + vec3(13.0, 7.0, uTime * 0.006));
  float n3 = fbm(dir * 9.0 + vec3(3.0, 21.0, 5.0));
  vec3 color = uVoid;
  vec3 nebula = mix(uBlue, uViolet, smoothstep(0.35, 0.75, n1));
  nebula = mix(nebula, uOchre, smoothstep(0.62, 0.86, n2) * 0.75);
  float cloud = smoothstep(0.3, 0.8, n1 * 0.6 + n2 * 0.4) * (0.3 + 1.2 * band);
  color += nebula * cloud * 2.4; // lo bastante intensa para que el grading no la aplane
  // Filamentos oscuros de polvo que cortan la nebulosa.
  color *= 1.0 - 0.55 * smoothstep(0.55, 0.8, n3) * band;
  float starMask = 0.55 + 0.9 * band;
  color += stars(dir, uStarDensity, 0.965, 0.22) * starMask;
  color += stars(dir, uStarDensity * 2.6, 0.985, 0.18) * starMask * 0.8;
  color += stars(dir, uStarDensity * 0.55, 0.993, 0.12) * 2.2; // pocas, grandes y brillantes
  // Luna fría con halo.
  float m = dot(dir, normalize(uMoonDir));
  color += uMoonColor * (smoothstep(0.9993, 0.9996, m) * 3.0 + pow(max(m, 0.0), 220.0) * 0.6 + pow(max(m, 0.0), 18.0) * 0.06);
  // Horizonte: se funde con la niebla para que las islas lejanas no tengan borde.
  float horizon = exp(-pow(dir.y / 0.16, 2.0));
  color = mix(color, uFog, horizon * 0.8);
  gl_FragColor = vec4(color, 1.0);
}
`;

interface Meteor { mesh: THREE.Mesh; active: boolean; age: number; life: number; from: THREE.Vector3; to: THREE.Vector3; }

/** Cielo, constelaciones y meteoros. Todo sigue a la cámara (está «en el infinito»). */
export class CosmicSky {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly constellations: THREE.Group;
  private readonly meteors: Meteor[] = [];
  private nextMeteor = 4;
  private seed = 97;

  constructor(moonDirection: THREE.Vector3) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uVoid: { value: new THREE.Color(PALETTE.abyss) },
        uFog: { value: new THREE.Color(PALETTE.fog) },
        uViolet: { value: new THREE.Color(PALETTE.nebulaViolet) },
        uBlue: { value: new THREE.Color(PALETTE.nebulaBlue) },
        uOchre: { value: new THREE.Color(PALETTE.nebulaOchre) },
        uMoonDir: { value: moonDirection.clone().normalize() },
        uMoonColor: { value: new THREE.Color(PALETTE.moonlight) },
        uStarDensity: { value: 210 },
      },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), this.material);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.constellations = buildConstellations();
    this.group.add(sky, this.constellations);
    for (let i = 0; i < METEORS; i++) {
      const mesh = meteorMesh();
      mesh.visible = false;
      this.meteors.push({ mesh, active: false, age: 0, life: 1, from: new THREE.Vector3(), to: new THREE.Vector3() });
      this.group.add(mesh);
    }
  }

  update(dt: number, t: number, camera: THREE.Camera): void {
    this.group.position.copy(camera.position);
    this.material.uniforms['uTime']!.value = t;
    this.constellations.rotation.y += dt * 0.0025; // imperceptible
    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0) {
      this.launchMeteor();
      this.nextMeteor = 5 + this.rand() * 9;
    }
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.age += dt;
      const u = m.age / m.life;
      if (u >= 1) {
        m.active = false;
        m.mesh.visible = false;
        continue;
      }
      m.mesh.position.lerpVectors(m.from, m.to, u);
      m.mesh.lookAt(m.to);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * u);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }

  /** Meteoro lento que cruza el horizonte lejano, por encima de las islas. */
  private launchMeteor(): void {
    const m = this.meteors.find((x) => !x.active);
    if (!m) return;
    const azimuth = this.rand() * Math.PI * 2;
    const elevation = 0.08 + this.rand() * 0.3;
    const sweep = 0.35 + this.rand() * 0.4;
    const at = (a: number, e: number) => new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(SKY_RADIUS * 0.9);
    m.from.copy(at(azimuth, elevation + 0.12));
    m.to.copy(at(azimuth + sweep, elevation - 0.05));
    m.age = 0;
    m.life = 3.5 + this.rand() * 3;
    m.active = true;
    m.mesh.visible = true;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
}

/** Constelaciones geométricas: polígonos y estrellas en la esfera celeste, líneas tenues aditivas. */
function buildConstellations(): THREE.Group {
  const group = new THREE.Group();
  let seed = 41;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines: number[] = [];
  const points: number[] = [];
  const shapes = [3, 4, 5, 6, 5, 7, 3, 8, 4, 6];
  for (const sides of shapes) {
    const center = new THREE.Vector3(rand() * 2 - 1, 0.15 + rand() * 0.8, rand() * 2 - 1).normalize();
    const tangent = new THREE.Vector3(0, 1, 0).cross(center).normalize();
    const bitangent = center.clone().cross(tangent);
    const size = 0.07 + rand() * 0.08;
    const star = sides >= 5 && rand() > 0.5; // pentagrama/heptagrama: une vértices saltando uno
    const step = star ? 2 : 1;
    const vertex = (i: number) => {
      const a = (i / sides) * Math.PI * 2 + rand() * 0.15;
      return center.clone().addScaledVector(tangent, Math.cos(a) * size).addScaledVector(bitangent, Math.sin(a) * size)
        .normalize().multiplyScalar(CONSTELLATION_RADIUS);
    };
    const vs = Array.from({ length: sides }, (_, i) => vertex(i));
    for (let i = 0; i < sides; i++) {
      const a = vs[i]!;
      const b = vs[(i + step) % sides]!;
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      points.push(a.x, a.y, a.z);
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const lineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.moonlight).multiplyScalar(0.55), transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const pointMaterial = new THREE.PointsMaterial({
    color: new THREE.Color('#cfe0ff').multiplyScalar(2.2), size: 3.2, sizeAttenuation: false,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const linesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
  const pointsMesh = new THREE.Points(pointGeometry, pointMaterial);
  linesMesh.frustumCulled = false;
  pointsMesh.frustumCulled = false;
  linesMesh.renderOrder = -9;
  pointsMesh.renderOrder = -9;
  group.add(linesMesh, pointsMesh);
  return group;
}

/** Estela de meteoro: un cono alargado y aditivo, más brillante en la cabeza. */
function meteorMesh(): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(2.2, 140, 6, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -70);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffe9c4').multiplyScalar(2.5), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  return mesh;
}
