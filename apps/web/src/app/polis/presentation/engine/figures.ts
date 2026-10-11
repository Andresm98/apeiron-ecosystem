import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PALETTE, agentTone } from '../../domain/atmosphere';
import { CitizenState } from '../../domain/citizen-state';
import { lambert } from './places';

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

  constructor(readonly name: string, label: string, color: string, home: THREE.Vector3, remote: boolean) {
    // Túnica del color del agente en reposo (apagado): la luz de orador y el halo dicen cuándo actúa.
    this.figure = buildFigure(agentTone(color, false), label, (body) => {
      if (remote) body.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), lambert(PALETTE.moonlight)).translateY(2.95));
    });
    this.color = color;
    this.figure.root.position.copy(home);
    this.target.copy(home);
    this.figure.label.element.classList.toggle('polis-citizen-remote', remote);
  }

  get position(): THREE.Vector3 {
    return this.figure.root.position;
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
      // En reposo mira hacia el centro de la escena (tribuna o ágora).
      const toward = new THREE.Vector3().subVectors(lookAt, pos);
      if (toward.lengthSq() > 0.01) this.figure.root.rotation.y = Math.atan2(toward.x, toward.z);
    }
    const busy = this.state === 'working' || this.state === 'using_tool';
    this.figure.body.position.y = this.walking ? Math.abs(Math.sin(t * 9)) * 0.18 : busy ? Math.sin(t * 3) * 0.08 + 0.1 : 0;
    const pulse = busy ? 1 + Math.sin(t * 6) * 0.18 : 1;
    this.figure.halo.scale.setScalar(pulse);
  }
}
