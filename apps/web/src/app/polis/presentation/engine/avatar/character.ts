import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimatorFrame } from './animator';
import { type Gesture, bone } from './clips';
import { BONES, type BoneName, RIG, bindPosition } from './rig';

/**
 * Diseño de ssanax: personaje estilizado propio (cabeza grande, pelo en punta, pañuelo anudado, faja con lazo,
 * mangas y perneras remangadas, guantes sin dedos y botas). Tonos de lino y cuero que viven en la penumbra; el
 * único acento saturado es el pañuelo: el color que dice «tú» en la ciudad.
 */
export const SSANAX_DESIGN = {
  skin: '#d6ab86',
  hair: '#4a2f1d',
  eyeWhite: '#efe9dc',
  pupil: '#17110c',
  shirt: '#c9c2b2',
  scarf: '#b4532a',
  sash: '#8a6a3a',
  pants: '#6c665a',
  glove: '#3f3024',
  boot: '#33261b',
  sole: '#1c1712',
} as const;

type Design = typeof SSANAX_DESIGN;

const BONE_INDEX = new Map(BONES.map((name, i) => [name, i]));

/** Pieza rígida del cuerpo: una primitiva colocada en el espacio del modelo y pintada, enganchada a un hueso. */
function part(
  geometry: THREE.BufferGeometry, color: string, bone: BoneName,
  at: [number, number, number], opts: { rot?: [number, number, number]; scale?: [number, number, number] } = {},
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0]))),
    new THREE.Vector3(...(opts.scale ?? [1, 1, 1])),
  );
  g.applyMatrix4(m);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color).convertSRGBToLinear();
  const colors = new Float32Array(n * 3);
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  const b = BONE_INDEX.get(bone)!;
  for (let i = 0; i < n; i++) {
    colors.set([c.r, c.g, c.b], i * 3);
    index[i * 4] = b;
    weight[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
  return g;
}

const P = (name: BoneName) => bindPosition(name);
const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cyl = (top: number, bottom: number, height: number, seg = 12) => new THREE.CylinderGeometry(top, bottom, height, seg);
const torus = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 18);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

function limb(side: 1 | -1, d: Design): THREE.BufferGeometry[] {
  const s = side === 1 ? 'L' : 'R';
  const [ux, uy] = P(`upperArm.${s}`);
  const [fx, fy] = P(`foreArm.${s}`);
  const [hx, hy] = P(`hand.${s}`);
  const [tx, ty] = P(`thigh.${s}`);
  const [sx, sy] = P(`shin.${s}`);
  const [ftx, fty] = P(`foot.${s}`);
  const ua = `upperArm.${s}` as BoneName;
  const fa = `foreArm.${s}` as BoneName;
  const ha = `hand.${s}` as BoneName;
  const th = `thigh.${s}` as BoneName;
  const sh = `shin.${s}` as BoneName;
  const ft = `foot.${s}` as BoneName;
  const parts = [
    // Brazo: manga corta remangada, antebrazo, guante sin dedos y yemas.
    part(sphere(0.09), d.shirt, ua, [ux - 0.01 * side, uy, 0]),
    part(cyl(0.075, 0.07, 0.2), d.shirt, ua, [(ux + fx) / 2 - 0.005 * side, uy - 0.1, 0]),
    part(torus(0.072, 0.026), d.shirt, ua, [fx - 0.01 * side, fy + 0.08, 0], { rot: [Math.PI / 2, 0, 0] }),
    part(sphere(0.055), d.skin, fa, [fx, fy, 0]),
    part(cyl(0.055, 0.047, 0.24), d.skin, fa, [(fx + hx) / 2, (fy + hy) / 2, 0]),
    part(torus(0.05, 0.022), d.glove, fa, [hx, hy + 0.03, 0], { rot: [Math.PI / 2, 0, 0] }),
    part(sphere(0.075), d.glove, ha, [hx + 0.005 * side, hy - 0.07, 0.005], { scale: [0.75, 1, 0.62] }),
    part(sphere(0.03), d.skin, ha, [hx - 0.04 * side, hy - 0.05, 0.05]), // pulgar
    ...[-0.03, -0.01, 0.01, 0.03].map((z) =>
      part(cyl(0.017, 0.015, 0.06, 6), d.skin, ha, [hx + 0.005 * side, hy - 0.15, z * 1.4 + 0.005])),
    // Pierna: pantalón ancho remangado y bota.
    part(cyl(0.115, 0.1, 0.44), d.pants, th, [tx, (ty + sy) / 2, 0]),
    part(sphere(0.1), d.pants, sh, [sx, sy, 0]),
    part(cyl(0.1, 0.118, 0.34), d.pants, sh, [sx, sy - 0.17, 0]),
    part(torus(0.112, 0.036), d.pants, sh, [sx, sy - 0.32, 0], { rot: [Math.PI / 2, 0, 0] }),
    part(cyl(0.085, 0.09, 0.2), d.boot, ft, [ftx, fty + 0.02, 0]),
    part(box(0.17, 0.1, 0.26), d.boot, ft, [ftx, fty - 0.05, 0.05]),
    part(sphere(0.088), d.boot, ft, [ftx, fty - 0.045, 0.17], { scale: [1, 0.62, 1.05] }),
    part(box(0.18, 0.03, 0.34), d.sole, ft, [ftx, fty - 0.09, 0.07]),
    part(torus(0.088, 0.016), d.sole, ft, [ftx, fty + 0.1, 0], { rot: [Math.PI / 2, 0, 0] }), // borde de la caña
  ];
  return parts;
}

/** Malla única del personaje (un draw call, más uno de sombra) con piezas rígidas por hueso. */
export function buildCharacterGeometry(d: Design = SSANAX_DESIGN): THREE.BufferGeometry {
  const [, headY] = P('head');
  const hy = headY + 0.3; // centro del cráneo
  const [, chestY] = P('chest');
  const [, spineY] = P('spine');
  const [, hipsY] = P('hips');
  const [, neckY] = P('neck');
  const [scx, scy, scz] = P('scarf');
  const [sax, say, saz] = P('sash');
  const [ex, ey, ez] = P('eyes');
  const [, hairY] = P('hair');
  const parts: THREE.BufferGeometry[] = [
    // Cabeza
    part(sphere(0.34, 20, 16), d.skin, 'head', [0, hy, 0], { scale: [1, 1.04, 0.95] }),
    part(sphere(0.07), d.skin, 'head', [0.33, hy - 0.02, 0], { scale: [0.55, 1, 0.85] }),
    part(sphere(0.07), d.skin, 'head', [-0.33, hy - 0.02, 0], { scale: [0.55, 1, 0.85] }),
    part(sphere(0.04), d.skin, 'head', [0, hy - 0.07, 0.33]),
    part(new THREE.TorusGeometry(0.05, 0.011, 4, 12, Math.PI), d.pupil, 'head', [0, hy - 0.14, 0.305], { rot: [0.25, 0, Math.PI] }), // sonrisa leve
    // Cejas algo caídas hacia fuera: gesto atento y amable, no de enfado.
    part(box(0.11, 0.024, 0.03), d.hair, 'head', [0.12, hy + 0.135, 0.305], { rot: [0, 0, 0.14] }),
    part(box(0.11, 0.024, 0.03), d.hair, 'head', [-0.12, hy + 0.135, 0.305], { rot: [0, 0, -0.14] }),
    // Ojos (hueso propio: parpadean y miran)
    part(sphere(0.072), d.eyeWhite, 'eyes', [ex + 0.12, ey, ez], { scale: [1, 1.15, 0.55] }),
    part(sphere(0.072), d.eyeWhite, 'eyes', [ex - 0.12, ey, ez], { scale: [1, 1.15, 0.55] }),
    part(sphere(0.04), d.pupil, 'eyes', [ex + 0.12, ey - 0.005, ez + 0.035], { scale: [1, 1.2, 0.6] }),
    part(sphere(0.04), d.pupil, 'eyes', [ex - 0.12, ey - 0.005, ez + 0.035], { scale: [1, 1.2, 0.6] }),
    // Pelo: casquete en la cabeza y mechones en punta en un hueso con física secundaria.
    // Casquete inclinado hacia atrás: deja la frente y los ojos a la vista.
    part(new THREE.SphereGeometry(0.365, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), d.hair, 'head', [0, hy + 0.03, -0.04], { rot: [0.38, 0, 0] }),
    ...[[0.16, 0.2, 0.24, -0.55, 0.55], [-0.15, 0.21, 0.25, -0.5, -0.6], [0.02, 0.24, 0.26, -0.75, 0.1], [0.08, 0.19, 0.28, -0.95, 0.45]]
      .map(([x, y, z, rx, rz]) => part(new THREE.ConeGeometry(0.06, 0.17, 7), d.hair, 'head', [x!, hy + y!, z!], { rot: [rx! + Math.PI, 0, rz!] })), // flequillo
    ...[[0, 0.18, -0.02, -0.3, 0], [0.15, 0.12, -0.08, -0.5, -0.6], [-0.14, 0.13, -0.06, -0.4, 0.7], [0.06, 0.1, -0.2, -1.1, -0.2],
      [-0.08, 0.08, -0.22, -1.2, 0.3], [0.2, -0.02, -0.12, -0.9, -1.1], [-0.2, 0, -0.1, -0.8, 1.1]]
      .map(([x, y, z, rx, rz]) => part(new THREE.ConeGeometry(0.1, 0.36, 7), d.hair, 'hair', [x!, hairY + y! - 0.08, z!], { rot: [rx!, 0, rz!] })),
    // Cuello y torso: camisa de lino con pañuelo anudado.
    part(cyl(0.07, 0.075, 0.16), d.skin, 'neck', [0, neckY + 0.04, 0]),
    part(cyl(0.2, 0.215, 0.26), d.shirt, 'chest', [0, chestY + 0.11, 0], { scale: [1, 1, 0.74] }),
    part(sphere(0.1), d.shirt, 'chest', [0.2, chestY + 0.17, 0], { scale: [1, 0.8, 0.8] }),
    part(sphere(0.1), d.shirt, 'chest', [-0.2, chestY + 0.17, 0], { scale: [1, 0.8, 0.8] }),
    part(cyl(0.215, 0.225, 0.24), d.shirt, 'spine', [0, spineY + 0.1, 0], { scale: [1, 1, 0.76] }),
    part(torus(0.125, 0.048), d.scarf, 'chest', [0, neckY - 0.01, 0.01], { rot: [Math.PI / 2 - 0.25, 0, 0], scale: [1, 0.85, 1] }),
    part(sphere(0.055), d.scarf, 'scarf', [scx, scy, scz]),
    part(box(0.075, 0.22, 0.025), d.scarf, 'scarf', [scx - 0.025, scy - 0.12, scz + 0.01], { rot: [0.08, 0, 0.18] }),
    part(box(0.07, 0.18, 0.025), d.scarf, 'scarf', [scx + 0.035, scy - 0.1, scz + 0.005], { rot: [0.05, 0, -0.25] }),
    // Cintura: faja con lazo, pantalón.
    part(torus(0.228, 0.042), d.sash, 'hips', [0, hipsY + 0.07, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.78, 1] }),
    part(sphere(0.055), d.sash, 'sash', [sax, say, saz]),
    part(box(0.07, 0.2, 0.025), d.sash, 'sash', [sax - 0.02, say - 0.11, saz + 0.01], { rot: [0.06, 0, 0.12] }),
    part(box(0.065, 0.17, 0.025), d.sash, 'sash', [sax + 0.04, say - 0.09, saz], { rot: [0.04, 0, -0.3] }),
    part(cyl(0.225, 0.2, 0.18), d.pants, 'hips', [0, hipsY - 0.01, 0], { scale: [1, 1, 0.78] }),
    ...limb(1, d),
    ...limb(-1, d),
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** Muelle amortiguado de un grado de libertad (física secundaria de pelo, pañuelo y faja). */
export class Spring {
  value = 0;
  private velocity = 0;

  constructor(private readonly stiffness = 70, private readonly damping = 9) {}

  update(target: number, dt: number): number {
    const accel = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

export interface CharacterMotion {
  dt: number;
  t: number;
  /** Velocidad en el mundo (m/s) y giro (rad/s) del cuerpo. */
  velocity: THREE.Vector3;
  yawRate: number;
  /** Punto que mira (orador, lugar cercano) o null. */
  look: THREE.Vector3 | null;
}

/** Contrato común del avatar procedural y del glTF. */
export interface PlayerAvatar {
  readonly root: THREE.Group;
  readonly halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly label: CSS2DObject;
  apply(frame: AnimatorFrame, motion: CharacterMotion): void;
  dispose(): void;
}

/** Lo que rodea a cualquier avatar del jugador: halo (tu turno), sombra de contacto y rótulo con el nombre. */
export function decorations(name: string): {
  halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; contact: THREE.Mesh; label: CSS2DObject;
} {
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.04, 4, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.06;
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.5, depthWrite: false }),
  );
  contact.position.y = 0.03;
  contact.renderOrder = 1;
  const tag = document.createElement('div');
  tag.className = 'polis-citizen';
  tag.innerHTML = `<span class="polis-citizen-name"></span><span class="polis-citizen-state"></span>`;
  tag.querySelector('.polis-citizen-name')!.textContent = name;
  const label = new CSS2DObject(tag);
  label.position.y = 2.95;
  return { halo, contact, label };
}

/** La sombra de contacto encoge y se aclara al despegar; el halo se queda en el suelo. */
export function groundDecorations(root: THREE.Object3D, halo: THREE.Mesh, contact: THREE.Mesh): void {
  const height = Math.max(0, root.position.y);
  contact.position.y = 0.03 - height;
  contact.scale.setScalar(Math.max(0.35, 1 - height * 0.35));
  (contact.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.max(0.3, 1 - height * 0.3);
  halo.position.y = 0.06 - height;
}

const HEAD_YAW_MAX = 1.1;
const HEAD_PITCH_MAX = 0.45;

/**
 * ssanax con esqueleto: aplica la pose del animador a los huesos y añade lo que depende del mundo: mirada hacia
 * un objetivo, parpadeo, física secundaria (pelo, pañuelo, faja), inclinación en las curvas y con la aceleración, y
 * squash del aterrizaje.
 */
export class Character implements PlayerAvatar {
  readonly root = new THREE.Group();
  readonly halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly label: CSS2DObject;
  private readonly lean = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly bones = new Map<BoneName, THREE.Bone>();
  private readonly contact: THREE.Mesh;
  private readonly hair = new Spring(60, 7);
  private readonly scarf = new Spring(40, 5);
  private readonly sash = new Spring(45, 6);
  private readonly headYaw = new Spring(30, 10);
  private readonly headPitch = new Spring(30, 10);
  private readonly lastVelocity = new THREE.Vector3();
  private nextBlink = 2.2;
  private blinkSeed = 11;

  constructor(name: string, design: Design = SSANAX_DESIGN) {
    for (const boneName of BONES) {
      const b = new THREE.Bone();
      b.name = boneName;
      b.position.set(...RIG[boneName].offset);
      this.bones.set(boneName, b);
      const parent = RIG[boneName].parent;
      if (parent) this.bones.get(parent)!.add(b);
    }
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.SkinnedMesh(buildCharacterGeometry(design), material);
    const rootBone = this.bones.get('root')!;
    this.mesh.add(rootBone);
    this.mesh.bind(new THREE.Skeleton(BONES.map((b) => this.bones.get(b)!)));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // los brazos en alto salen de la esfera de la pose de enlace
    this.lean.add(this.mesh);

    const deco = decorations(name);
    this.halo = deco.halo;
    this.contact = deco.contact;
    this.label = deco.label;
    this.root.add(this.lean, this.halo, this.contact, this.label);
  }

  apply(frame: AnimatorFrame, motion: CharacterMotion): void {
    const dt = Math.max(motion.dt, 1e-3);
    const pose = frame.pose;
    for (const name of BONES) {
      if (name === 'root') continue;
      const [x, y, z] = bone(pose, name);
      this.bones.get(name)!.rotation.set(x, y, z);
    }
    const hips = this.bones.get('hips')!;
    hips.position.y = RIG.hips.offset[1] + pose.hipsY;

    // Movimiento en el espacio del personaje.
    const yaw = this.root.rotation.y;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const speed = Math.hypot(motion.velocity.x, motion.velocity.z);
    const accel = motion.velocity.clone().sub(this.lastVelocity).divideScalar(dt);
    this.lastVelocity.copy(motion.velocity);
    const accelForward = THREE.MathUtils.clamp(accel.dot(forward), -40, 40);

    // Inclinación: hacia dentro en las curvas y hacia delante al acelerar; squash al aterrizar.
    this.lean.rotation.z = THREE.MathUtils.damp(this.lean.rotation.z, THREE.MathUtils.clamp(-motion.yawRate * speed * 0.03, -0.3, 0.3), 8, dt);
    this.lean.rotation.x = THREE.MathUtils.damp(this.lean.rotation.x, THREE.MathUtils.clamp(accelForward * 0.008, -0.12, 0.16), 6, dt);
    const s = pose.squash;
    this.lean.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);

    // Física secundaria: el pelo y los lazos se quedan atrás con la velocidad y rebotan con los cambios.
    const run = Math.min(1, speed / 8);
    const air = THREE.MathUtils.clamp(-motion.velocity.y * 0.04, -0.4, 0.4);
    this.bones.get('hair')!.rotation.x += this.hair.update(-0.22 * run - accelForward * 0.006 + air * 0.5, dt);
    this.bones.get('scarf')!.rotation.x += this.scarf.update(0.9 * run + accelForward * 0.012 - air, dt);
    this.bones.get('scarf')!.rotation.z += 0.12 * Math.sin(motion.t * 7) * run;
    this.bones.get('sash')!.rotation.x += this.sash.update(0.7 * run + accelForward * 0.01 - air, dt);

    // Mirada: cabeza y cuello giran hacia el objetivo, con límites y suavizado.
    let wantYaw = 0;
    let wantPitch = 0;
    if (motion.look) {
      const head = this.bones.get('head')!.getWorldPosition(new THREE.Vector3()).setY(this.root.position.y + 1.9);
      const to = motion.look.clone().sub(head);
      const local = to.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      wantYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -HEAD_YAW_MAX, HEAD_YAW_MAX);
      if (Math.abs(Math.atan2(local.x, local.z)) > 2.2) wantYaw = 0; // detrás: no se retuerce
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(to.y, Math.hypot(to.x, to.z)), -HEAD_PITCH_MAX, HEAD_PITCH_MAX);
    }
    const lookYaw = this.headYaw.update(wantYaw, dt);
    const lookPitch = this.headPitch.update(wantPitch, dt);
    this.bones.get('head')!.rotation.y += lookYaw * 0.65;
    this.bones.get('neck')!.rotation.y += lookYaw * 0.35;
    this.bones.get('head')!.rotation.x += lookPitch * 0.7;
    this.bones.get('eyes')!.rotation.y = THREE.MathUtils.clamp(wantYaw - lookYaw, -0.25, 0.25);

    // Parpadeo cada 2–5,5 s (secuencia determinista).
    const eyes = this.bones.get('eyes')!;
    const sinceBlink = motion.t - this.nextBlink;
    if (sinceBlink > 0.14) {
      this.blinkSeed = (this.blinkSeed * 16807) % 2147483647;
      this.nextBlink = motion.t + 2 + (this.blinkSeed / 2147483647) * 3.5;
    }
    eyes.scale.y = sinceBlink >= 0 && sinceBlink <= 0.14 ? 0.1 + 0.9 * Math.abs(sinceBlink / 0.07 - 1) : 1;

    groundDecorations(this.root, this.halo, this.contact);
  }

  /** Para tests y depuración: rotación actual de un hueso. */
  rotationOf(name: BoneName): THREE.Euler {
    return this.bones.get(name)!.rotation;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.skeleton.dispose();
    this.halo.geometry.dispose();
    this.halo.material.dispose();
    this.contact.geometry.dispose();
    (this.contact.material as THREE.Material).dispose();
    this.label.element.remove();
  }
}

export type { Gesture };
