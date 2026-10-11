import type * as RapierNS from '@dimforge/rapier3d-compat';
import type { Quat, Vec3 } from '../../../domain/landmark-conventions.ts';
import type { Flat, PlacedPlan, PolisPhysics } from './walkable.ts';

type Rapier = typeof RapierNS;

/** Cápsula de ssanax: 2,5 m de alto (ADR-013 §5.5), con el centro a media altura. */
const CAPSULE = { halfHeight: 0.8, radius: 0.45, centerY: 1.25 };
/** Holgura del controlador de personaje (Rapier recomienda unos centímetros). */
const SKIN = 0.04;

// Transformaciones mínimas (sin Three.js: este módulo se prueba en Node).

function yaw(angle: number): Quat {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Lleva un punto del espacio del landmark al de la ciudad (giro en Y + traslación). */
export function toCity(placed: Pick<PlacedPlan, 'x' | 'z' | 'rotationY'>, p: Vec3): Vec3 {
  const c = Math.cos(placed.rotationY);
  const s = Math.sin(placed.rotationY);
  return [placed.x + p[0] * c + p[2] * s, p[1], placed.z - p[0] * s + p[2] * c];
}

const asVector = ([x, y, z]: Vec3) => ({ x, y, z });
const asRotation = ([x, y, z, w]: Quat) => ({ x, y, z, w });

/**
 * Física con Rapier (ADR-013 §5.4–5.5, subfase 5c): cada `fixed_*` de un landmark es un cuerpo rígido fijo con su
 * colisionador (caja, cilindro o trimesh según el sufijo) y cada `sensor_*` un colisionador sensor, todo colocado
 * desde el plan de convenciones y la posición que decide `layoutCity`. ssanax es una cápsula movida por el
 * controlador de personaje (desliza por las paredes). El suelo sigue siendo el de `fallback` (islas y puentes) hasta
 * que los assets traigan `walk_*`: así nunca cae al agua.
 *
 * Rapier (WASM) se importa de forma dinámica: solo se descarga si algún landmark trae colisionadores.
 */
export class RapierPhysics implements PolisPhysics {
  private readonly R: Rapier;
  private readonly world: RapierNS.World;
  private readonly character: RapierNS.Collider;
  private readonly controller: RapierNS.KinematicCharacterController;
  private readonly fallback: PolisPhysics;
  private readonly sensorIds = new Map<number, string>();
  readonly colliderCount: number;

  private constructor(R: Rapier, placed: PlacedPlan[], fallback: PolisPhysics) {
    this.R = R;
    this.fallback = fallback;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    let count = 0;
    for (const p of placed) {
      const turn = yaw(p.rotationY);
      for (const c of p.plan.colliders) {
        if (c.shape === 'trimesh') {
          // La malla viene en espacio del landmark: el cuerpo se coloca en el origen del landmark.
          const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, 0, p.z).setRotation(asRotation(turn)));
          this.world.createCollider(R.ColliderDesc.trimesh(c.vertices!, c.indices!), body);
        } else {
          const [hx, hy, hz] = c.halfExtents;
          const desc = c.shape === 'box' ? R.ColliderDesc.cuboid(hx, hy, hz) : R.ColliderDesc.cylinder(hy, Math.max(hx, hz));
          const body = this.world.createRigidBody(
            R.RigidBodyDesc.fixed().setTranslation(...toCity(p, c.position)).setRotation(asRotation(multiply(turn, c.rotation))),
          );
          this.world.createCollider(desc, body);
        }
        count += 1;
      }
      for (const s of p.plan.sensors) {
        const [hx, hy, hz] = s.halfExtents;
        const desc = R.ColliderDesc.cuboid(hx, hy, hz)
          .setSensor(true)
          .setTranslation(...toCity(p, s.position))
          .setRotation(asRotation(multiply(turn, s.rotation)));
        const collider = this.world.createCollider(desc);
        this.sensorIds.set(collider.handle, `${p.placeId}:${s.id}`);
      }
    }
    this.colliderCount = count;
    this.character = this.world.createCollider(R.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius).setTranslation(0, CAPSULE.centerY, 0));
    this.controller = this.world.createCharacterController(SKIN);
    this.controller.setSlideEnabled(true);
    this.world.step(); // construye la estructura de consultas con los cuerpos fijos
  }

  /** Carga Rapier (WASM) y construye el mundo físico. */
  static async create(placed: PlacedPlan[], fallback: PolisPhysics): Promise<RapierPhysics> {
    const module = await import('@dimforge/rapier3d-compat');
    const R = (module.default ?? module) as Rapier;
    await R.init();
    return new RapierPhysics(R, placed, fallback);
  }

  move(from: Flat, delta: Flat): Flat {
    this.character.setTranslation({ x: from.x, y: CAPSULE.centerY, z: from.z });
    this.controller.computeColliderMovement(
      this.character,
      { x: delta.x, y: 0, z: delta.z },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const done = this.controller.computedMovement();
    // Lo que Rapier deja pasar aún debe quedar sobre suelo pisable (islas y puentes).
    return this.fallback.move(from, { x: done.x, z: done.z });
  }

  sensors(at: Flat): string[] {
    const found: string[] = [];
    this.world.intersectionsWithPoint({ x: at.x, y: CAPSULE.centerY, z: at.z }, (collider) => {
      const id = this.sensorIds.get(collider.handle);
      if (id) found.push(id);
      return true;
    });
    return found.sort();
  }

  dispose(): void {
    this.controller.free();
    this.world.free();
  }
}
