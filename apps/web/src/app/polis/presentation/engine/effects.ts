import * as THREE from 'three';

/** Efecto efímero: devuelve false cuando termina y debe retirarse de la escena. */
interface Effect {
  object: THREE.Object3D;
  update(dt: number): boolean;
}

type Anchor = () => THREE.Vector3;

const orbGeometry = new THREE.IcosahedronGeometry(0.32, 1);

function basic(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** Punto de una parábola entre a y b, elevada `lift` en su centro. */
function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, lift: number): THREE.Vector3 {
  const arc = Math.max(lift, a.distanceTo(b) * 0.18); // a escala monumental el arco crece con la distancia
  return new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * arc);
}

/** Señales de la ejecución dibujadas en la Polis (ADR-013): cada clase de señal tiene su forma. */
export class Effects {
  private readonly active: Effect[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Flujo de control: un pulso sale del núcleo de Ápeiron hacia quien recibe la palabra. */
  pulse(from: Anchor, to: Anchor, color = '#f6d27a'): void {
    const orb = new THREE.Mesh(orbGeometry, basic(color));
    let t = 0;
    this.add({
      object: orb,
      update: (dt) => {
        t += dt / 0.9;
        orb.position.copy(arcPoint(from(), to().clone().setY(2.4), Math.min(t, 1), 3));
        return t < 1;
      },
    });
  }

  /** Comunicación: un haz une al orador con el interlocutor al que responde. */
  reply(from: Anchor, to: Anchor, color = '#ffe8a3'): void {
    const segments = 24;
    const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: segments + 1 }, () => new THREE.Vector3()));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    const runner = new THREE.Mesh(orbGeometry, basic('#ffffff'));
    line.add(runner);
    let life = 0;
    this.add({
      object: line,
      update: (dt) => {
        life += dt;
        const a = from().clone().setY(2.6);
        const b = to().clone().setY(2.6);
        const positions = geometry.attributes['position'] as THREE.BufferAttribute;
        for (let i = 0; i <= segments; i++) {
          const p = arcPoint(a, b, i / segments, 2.2);
          positions.setXYZ(i, p.x, p.y, p.z);
        }
        positions.needsUpdate = true;
        runner.position.copy(arcPoint(a, b, Math.min(life / 1.2, 1), 2.2));
        material.opacity = life < 2 ? 1 : Math.max(0, 1 - (life - 2) / 1.5);
        (runner.material as THREE.MeshBasicMaterial).opacity = material.opacity;
        return life < 3.5;
      },
    });
  }

  /** Herramienta: un mensajero va del agente al edificio y vuelve. */
  messenger(agent: Anchor, building: THREE.Vector3, error: boolean): void {
    const orb = new THREE.Mesh(orbGeometry, basic(error ? '#ef6461' : '#7fd3ff'));
    let t = 0;
    const target = building.clone().setY(3);
    this.add({
      object: orb,
      update: (dt) => {
        t += dt / 2.2;
        const a = agent().clone().setY(2.4);
        const phase = t < 0.5 ? t * 2 : 2 - t * 2;
        orb.position.copy(arcPoint(a, target, Math.max(0, Math.min(phase, 1)), 4));
        return t < 1;
      },
    });
  }

  /** Guardrail: destello circular que se expande y se apaga. */
  flash(at: Anchor, color = '#f4a259'): void {
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 4, 32), basic(color));
    ringMesh.rotation.x = Math.PI / 2;
    let life = 0;
    this.add({
      object: ringMesh,
      update: (dt) => {
        life += dt;
        ringMesh.position.copy(at()).setY(0.3);
        ringMesh.scale.setScalar(1 + life * 3);
        (ringMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - life / 1.2);
        return life < 1.2;
      },
    });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!;
      if (!effect.update(dt)) {
        this.scene.remove(effect.object);
        dispose(effect.object);
        this.active.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const effect of this.active) {
      this.scene.remove(effect.object);
      dispose(effect.object);
    }
    this.active.length = 0;
  }

  private add(effect: Effect): void {
    effect.update(0);
    this.scene.add(effect.object);
    this.active.push(effect);
  }
}

/** Libera geometrías y materiales propios (la geometría compartida del orbe se conserva). */
export function dispose(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && m.geometry !== orbGeometry) m.geometry.dispose();
    const material = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((x) => x.dispose());
    else material?.dispose();
  });
}
