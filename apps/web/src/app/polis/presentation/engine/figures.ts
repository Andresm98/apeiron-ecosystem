import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { PALETTE, agentTone } from '../../domain/atmosphere';
import { CitizenState } from '../../domain/citizen-state';
import { approach, statuePose } from '../../domain/statue-motion';
import { Animator, RUN_SPEED } from './avatar/animator';
import type { RiggedModel } from './avatar/rigged-model';
import { lambert } from './places';

/** Estatuas de los ciudadanos (ADR-013, estatuas vivas): `characters/<figura>.glb`, si se publica. */
const CHARACTERS = 'assets/polis/characters/';
const STATUE_HEIGHT = 3.2; // algo más que ssanax (2,5 m): estatuas, no personas
const STATUE_LABEL_Y = 3.7;
/** A partir de esta atención, la estatua se vuelve hacia ssanax. */
const ATTEND_TURN = 0.2;
/** Cuánto tiñe el color del agente el mármol (0 = mármol, 1 = color pleno): en su color y en su luz propia. */
const MARBLE_TINT = 0.22;
const GLOW_TINT = 0.5;
/** Altura de un agente con figura animada: algo más que ssanax, como las estatuas, y su rótulo encima. */
export const RIG_HEIGHT = 2.8;
const RIG_LABEL_Y = 3.3;
/** Velocidad de animación tope de un agente animado: sus viajes largos van más rápido (llegan en ~1,3 s). */
const RIG_MAX_SPEED = RUN_SPEED * 1.3;
/**
 * Aura de un agente animado: su color como luz propia, con la intensidad de la estatua (`statuePose().glow`) por
 * este factor. Así una figura oscura no es una silueta de noche y, como las estatuas, se enciende al acercarse ssanax.
 */
const RIG_AURA = 0.32;
const statues = new Map<string, Promise<THREE.Object3D>>();

/** Una estatua (`<figura>.glb`), de pie en y = 0 y a 3,2 m. Se carga una vez; cada ciudadano la clona. */
export function loadStatue(figure: string): Promise<THREE.Object3D> {
  let statue = statues.get(figure);
  if (statue) return statue;
  statue = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${CHARACTERS}${figure}.glb`).then((gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const k = STATUE_HEIGHT / (box.max.y - box.min.y || 1);
    model.scale.multiplyScalar(k);
    model.position.y -= box.min.y * k;
    return model;
  });
  statue.catch(() => statues.delete(figure)); // un fallo no se queda cacheado
  statues.set(figure, statue);
  return statue;
}

/** Sombra de contacto (horneada, ADR-013 §5.1): un disco oscuro bajo cada figura en todos los niveles de calidad. */
const contactGeometry = new THREE.CircleGeometry(0.95, 20).rotateX(-Math.PI / 2);

/** Figura humana low-poly: túnica, cabeza, halo a ras de suelo y sombra de contacto. */
export interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  label: CSS2DObject;
}

export function buildFigure(robe: string, name: string, extra?: (body: THREE.Group) => void): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(new THREE.Mesh(new THREE.ConeGeometry(0.62, 2, 7), lambert(robe)).translateY(1));
  body.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), lambert('#b59a7f')).translateY(2.3));
  extra?.(body);
  body.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = true)));
  const contact = new THREE.Mesh(
    contactGeometry,
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false }),
  );
  contact.position.y = 0.03;
  contact.renderOrder = 1;
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.07, 4, 24),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.06;
  const tag = document.createElement('div');
  tag.className = 'polis-citizen';
  tag.innerHTML = `<span class="polis-citizen-name"></span><span class="polis-citizen-state"></span>`;
  tag.querySelector('.polis-citizen-name')!.textContent = name;
  const label = new CSS2DObject(tag);
  label.position.y = 3.1;
  root.add(body, halo, contact, label);
  return { root, body, halo, label };
}

const STATE_LOOK: Record<CitizenState, { color: string; opacity: number; text: string }> = {
  idle: { color: PALETTE.stoneLight, opacity: 0.25, text: '' },
  working: { color: '#ffd166', opacity: 0.95, text: 'razonando' },
  using_tool: { color: '#7fd3ff', opacity: 0.95, text: 'consultando' },
  done: { color: '#9ee493', opacity: 0.7, text: 'ha hablado' },
  degraded: { color: '#f4a259', opacity: 0.85, text: 'degradado' },
  error: { color: '#ef6461', opacity: 0.95, text: 'error' },
};

/** Ciudadano de la Polis: un agente que vive en su lugar y acude al ágora cuando lo convocan. */
export class Citizen {
  readonly figure: Figure;
  /** Color pleno del agente: el de su luz de orador. */
  readonly color: string;
  state: CitizenState = 'idle';
  private target = new THREE.Vector3();
  private walking = false;
  private speed = 7.5;
  /** Material del mármol de este ciudadano (su tinte y su brillo); `null` mientras sea la figura de cono. */
  private marble: THREE.MeshStandardMaterial | null = null;
  private readonly seed: number;
  private readonly remote: boolean;
  /** Figura animada (si su manifiesto la pide): camina y corre con sus clips y su propia máquina de estados. */
  private rig: RiggedModel | null = null;
  private aura: THREE.MeshStandardMaterial[] = [];
  private readonly animator = new Animator();
  /** Cuánto atiende a ssanax ∈ [0, 1] (`attentionAt`): en reposo se eleva, se ilumina y lo mira. */
  private attention = 0;
  private readonly visitor = new THREE.Vector3();

  constructor(readonly name: string, label: string, color: string, home: THREE.Vector3, remote: boolean) {
    // Túnica del color del agente en reposo (apagado): la luz de orador y el halo dicen cuándo actúa.
    this.figure = buildFigure(agentTone(color, false), label, (body) => {
      if (remote) body.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), lambert(PALETTE.moonlight)).translateY(2.95));
    });
    this.color = color;
    this.figure.root.position.copy(home);
    this.target.copy(home);
    this.figure.label.element.classList.toggle('polis-citizen-remote', remote);
    this.remote = remote;
    this.seed = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 7; // desfase estable por agente
  }

  /**
   * Sustituye la figura de cono por la estatua: mármol teñido con su color. La luz propia usa la misma textura
   * (`emissiveMap`), así de noche se lee el mármol, no una silueta, y al trabajar se enciende con su color.
   */
  useStatue(template: THREE.Object3D): void {
    this.clearBody();
    const body = this.figure.body;
    const model = template.clone(true);
    const color = new THREE.Color(this.color);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const marble = (mesh.material as THREE.MeshStandardMaterial).clone();
      marble.color = new THREE.Color('#ffffff').lerp(color, MARBLE_TINT);
      marble.emissive = new THREE.Color('#e8e4da').lerp(color, GLOW_TINT);
      marble.emissiveMap = marble.map;
      marble.emissiveIntensity = 0;
      mesh.material = this.marble = marble;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    body.add(model);
    if (this.remote) body.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), lambert(PALETTE.moonlight)).translateY(STATUE_LABEL_Y - 0.2));
    this.figure.label.position.y = STATUE_LABEL_Y;
  }

  /**
   * Sustituye la figura por un personaje animado (figura `rigged` del catálogo): camina en lugar de levitar. Lo
   * suyo (color, halo, rótulo, saludo) sigue igual.
   */
  useRig(rig: RiggedModel): void {
    this.clearBody();
    this.marble = null;
    this.rig?.dispose();
    this.rig = rig;
    if (rig.stride) this.animator.setStride(rig.stride);
    else this.animator.resetStride();
    // Materiales propios (la plantilla los comparte): el aura es del color de este agente.
    this.aura = [];
    rig.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      material.emissive = new THREE.Color(this.color);
      material.emissiveMap = null;
      material.emissiveIntensity = 0;
      mesh.material = material;
      this.aura.push(material);
    });
    this.figure.body.add(rig.object);
    if (this.remote) this.figure.body.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), lambert(PALETTE.moonlight)).translateY(RIG_LABEL_Y - 0.2));
    this.figure.label.position.y = RIG_LABEL_Y;
  }

  get position(): THREE.Vector3 {
    return this.figure.root.position;
  }

  /** Retira la figura actual (el cono procedural es propio y se libera; un rig o una estatua, de su plantilla). */
  private clearBody(): void {
    const body = this.figure.body;
    const own = !this.rig && !this.marble;
    this.rig?.dispose();
    this.rig = null;
    for (const child of [...body.children]) {
      body.remove(child);
      if (!own) continue;
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
  }

  /** Quieto en su sitio (no viaja hacia otro). */
  get resting(): boolean {
    return !this.walking;
  }

  /** ssanax se acerca (`level` de `attentionAt`, 0 si no debe atenderle) y está en `at`. */
  attend(level: number, at: THREE.Vector3): void {
    this.attention = level;
    this.visitor.copy(at);
  }

  /** Camina hacia `target`; los trayectos largos se aceleran para llegar en ~1,3 s. */
  goTo(target: THREE.Vector3): void {
    if (target.distanceTo(this.target) < 0.01) return;
    this.target.copy(target);
    this.speed = Math.max(7.5, Math.min(120, this.figure.root.position.distanceTo(target) / 1.3));
  }

  setState(state: CitizenState): void {
    this.state = state;
    const look = STATE_LOOK[state];
    this.figure.halo.material.color.set(look.color);
    this.figure.halo.material.opacity = look.opacity;
    const el = this.figure.label.element;
    el.querySelector('.polis-citizen-state')!.textContent = look.text;
    el.dataset['state'] = state;
  }

  update(dt: number, t: number, lookAt: THREE.Vector3): void {
    const pos = this.figure.root.position;
    const delta = new THREE.Vector3().subVectors(this.target, pos).setY(0);
    const distance = delta.length();
    this.walking = distance > 0.08;
    if (this.walking) {
      const step = Math.min(distance, this.speed * dt);
      pos.addScaledVector(delta.normalize(), step);
      this.figure.root.rotation.y = Math.atan2(delta.x, delta.z);
    } else {
      // En reposo mira hacia el centro de la escena (tribuna o ágora), o a ssanax si se le acerca; gira sin saltos.
      const toward = new THREE.Vector3().subVectors(this.attention > ATTEND_TURN ? this.visitor : lookAt, pos);
      if (toward.lengthSq() > 0.01) {
        const wanted = Math.atan2(toward.x, toward.z);
        const current = this.figure.root.rotation.y;
        const delta = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
        this.figure.root.rotation.y = approach(current, current + delta, dt, 4);
      }
    }
    const busy = this.state === 'working' || this.state === 'using_tool';
    const body = this.figure.body;
    if (this.rig) {
      // Personaje animado: camina o corre según su velocidad (los viajes largos, a tope de carrera) y piensa al trabajar.
      const speed = this.walking ? Math.min(this.speed, RIG_MAX_SPEED) : 0;
      const frame = this.animator.update({ dt, speed, grounded: true, vy: 0, thinking: busy, talking: false });
      this.rig.apply(frame.weights, dt);
      body.position.y = 0;
      const glow = statuePose(this.state, this.walking, t, this.seed, this.attention).glow * RIG_AURA;
      for (const material of this.aura) material.emissiveIntensity = approach(material.emissiveIntensity, glow, dt, 10);
    } else if (this.marble) {
      // Estatua viva: no camina, levita; respira, se inclina al viajar y su mármol brilla al trabajar.
      const pose = statuePose(this.state, this.walking, t, this.seed, this.attention);
      body.position.y = approach(body.position.y, pose.lift, dt);
      body.rotation.z = pose.sway;
      body.rotation.x = approach(body.rotation.x, pose.lean, dt);
      this.marble.emissiveIntensity = approach(this.marble.emissiveIntensity, pose.glow, dt, 10);
    } else {
      body.position.y = this.walking ? Math.abs(Math.sin(t * 9)) * 0.18 : busy ? Math.sin(t * 3) * 0.08 + 0.1 : this.attention * 0.2;
    }
    const pulse = busy ? 1 + Math.sin(t * 6) * 0.18 : 1;
    this.figure.halo.scale.setScalar(pulse);
  }
}
