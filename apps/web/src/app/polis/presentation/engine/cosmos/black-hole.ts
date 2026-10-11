import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { dispose } from '../effects';

/** Distancia a la cámara: lejos de la ciudad, dentro del plano lejano (3 km) y delante de la esfera del cielo. */
const DISTANCE = 1500;
/** Radio angular del disco de acreción, en radianes (≈ 26°: domina el cielo en esa dirección). */
const ANGULAR_RADIUS = 0.45;
/**
 * Altura del centro sobre el horizonte (≈ 9°): el disco asoma en el encuadre normal, casi horizontal, y se ve
 * entero al levantar la mirada (inclinación negativa de la cámara).
 */
const ELEVATION = 0.16;
/** Inclinación del disco hacia quien mira: casi de canto, con el arco de luz sobre la sombra. */
const TILT = 0.2;

/**
 * Agujero negro del cielo (pieza `black_hole`, ADR-013): un astro, no un edificio. Sigue a la cámara como la esfera
 * del cielo (sin paralaje) y cuelga en la dirección de la casa al ágora: desde la casa de ssanax, sobre el ágora.
 * Se dibuja tal como lo diseñó su autor: geometría y materiales del glTF intactos (emisivos y transparencias
 * incluidos), iluminados por un entorno de estudio propio en lugar de la luna, y sin niebla.
 */
export class BlackHole {
  readonly group = new THREE.Group();
  private readonly direction = new THREE.Vector3(0, Math.sin(ELEVATION), -Math.cos(ELEVATION));
  private readonly environment: THREE.Texture;

  constructor(template: THREE.Object3D, renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const model = template.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(box.getCenter(new THREE.Vector3()));
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) this.prepare(mesh);
    });
    const scaled = new THREE.Group();
    scaled.add(model);
    scaled.scale.setScalar((2 * DISTANCE * Math.tan(ANGULAR_RADIUS)) / Math.max(size.x, size.z));
    this.group.add(scaled);
    this.group.name = 'black_hole';
  }

  /** Dirección horizontal (x, z) en la que cuelga, p. ej. de la casa al ágora. */
  aim(x: number, z: number): void {
    const length = Math.hypot(x, z);
    if (!length) return;
    const c = Math.cos(ELEVATION);
    this.direction.set((x / length) * c, Math.sin(ELEVATION), (z / length) * c);
    // De frente a la ciudad (su +Z hacia la cámara) y con el disco inclinado hacia quien mira.
    this.group.rotation.set(TILT, Math.atan2(x, z) + Math.PI, 0, 'YXZ');
  }

  update(camera: THREE.Camera): void {
    this.group.position.copy(camera.position).addScaledVector(this.direction, DISTANCE);
  }

  dispose(): void {
    this.group.removeFromParent();
    dispose(this.group);
    this.environment.dispose();
  }

  /** Sus materiales, con su propia luz de estudio y sin la niebla de la ciudad (está a 1,5 km). */
  private prepare(mesh: THREE.Mesh): void {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial) continue;
      standard.fog = false;
      standard.envMap = this.environment;
      // La capa de distorsión de Sketchfab es un efecto de su visor: en el glTF es una malla transparente del todo.
      if (material.transparent && material.opacity === 0) mesh.visible = false;
    }
  }
}
