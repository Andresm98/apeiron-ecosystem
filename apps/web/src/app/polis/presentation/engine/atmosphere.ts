import * as THREE from 'three';
import { PALETTE, RenderSettings } from '../../domain/atmosphere';
import { AGORA_ID, BRIDGE_WIDTH, Place } from '../../domain/city-layout';

/** Luces dinámicas como mucho (ADR-013 §5.1): las de los oradores. Siempre 4 en escena para no recompilar shaders. */
export const SPEAKER_LIGHTS = 4;
/** Elevación de la luna: rasante, para sombras largas de diorama. */
const MOON_ELEVATION = 0.42;
const MOON_AZIMUTH = -0.9;
const MOON_DISTANCE = 140;
const SHADOW_EXTENT = 48; // cubre columnas de 22 m alrededor de ssanax

export interface Speaker { position: THREE.Vector3; color: string; intensity: number; height?: number; }

/**
 * Capa 0 y luz de la Polis en penumbra (ADR-013 §5.1–5.2): cielo, niebla exponencial, luz hemisférica fría débil, una
 * luna direccional rasante con sombras (según el nivel), planos de niebla baja sobre el agua, linternas cálidas
 * (emisivo + bloom, sin luz propia) y las luces de los oradores.
 */
export class Atmosphere {
  readonly fog = new THREE.FogExp2(PALETTE.fog, 0.0036);
  // Claroscuro extremo pero legible (principio 7): luna fría que recorta siluetas y un ambiente índigo bajo; la luz
  // cálida solo está donde hay algo que hacer (antorchas, farol de ssanax, quien habla).
  private readonly moon = new THREE.DirectionalLight(PALETTE.moonlight, 2.6);
  private readonly hemisphere = new THREE.HemisphereLight(PALETTE.cold, PALETTE.abyss, 1.1);
  private readonly fogPlanes = new THREE.Group();
  private readonly speakers: THREE.PointLight[] = [];
  private lanterns = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    // El fondo lo pinta el cielo cósmico (`cosmos/sky.ts`); esto solo cubre el primer fotograma.
    scene.background = new THREE.Color(PALETTE.abyss);
    scene.fog = this.fog;
    scene.add(this.hemisphere, this.moon, this.moon.target);

    const shadow = this.moon.shadow;
    shadow.camera.left = -SHADOW_EXTENT;
    shadow.camera.right = SHADOW_EXTENT;
    shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.near = 1;
    shadow.camera.far = 320;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.05;
    shadow.radius = 3;

    this.buildFogPlanes();
    scene.add(this.fogPlanes);

    for (let i = 0; i < SPEAKER_LIGHTS; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 16, 2);
      this.speakers.push(light);
      scene.add(light);
    }
  }

  /** Aplica el nivel de calidad: sombras, niebla baja y densidad. */
  apply(settings: RenderSettings, renderer: THREE.WebGLRenderer): void {
    const shadows = settings.shadowMapSize > 0;
    const changed = renderer.shadowMap.enabled !== shadows || (shadows && this.moon.shadow.mapSize.x !== settings.shadowMapSize);
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.moon.castShadow = shadows;
    if (shadows && this.moon.shadow.mapSize.x !== settings.shadowMapSize) {
      this.moon.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.fog.density = settings.fogDensity;
    this.fogPlanes.visible = settings.fogPlanes;
    // Activar o desactivar sombras cambia los shaders de todos los materiales que las reciben.
    if (changed) this.scene.traverse((o) => {
      const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
    });
  }

  /** La caja de sombras sigue a ssanax: sombras nítidas donde mira el jugador con un mapa acotado. */
  follow(point: THREE.Vector3): void {
    const texel = (SHADOW_EXTENT * 2) / Math.max(this.moon.shadow.mapSize.x, 1);
    // Ajuste a texel: la sombra no tiembla al caminar.
    const x = Math.round(point.x / texel) * texel;
    const z = Math.round(point.z / texel) * texel;
    this.moon.target.position.set(x, 0, z);
    this.moon.position.copy(moonDirection().multiplyScalar(MOON_DISTANCE)).add(this.moon.target.position);
  }

  /** El farol de ssanax y la luz de cada orador con el color de su agente (como mucho 4 en total). */
  setSpeakers(speakers: Speaker[]): void {
    this.speakers.forEach((light, i) => {
      const s = speakers[i];
      light.intensity = s ? s.intensity : 0;
      if (s) {
        light.color.set(s.color);
        light.position.copy(s.position).setY(s.position.y + (s.height ?? 3.2));
      }
    });
  }

  /** Linternas en la cabeza de cada puente: postes instanciados y llamas emisivas que alimentan el bloom. */
  setCity(places: Place[]): void {
    this.scene.remove(this.lanterns);
    disposeTree(this.lanterns);
    this.lanterns = buildLanterns(places);
    this.scene.add(this.lanterns);
  }

  update(t: number): void {
    this.fogPlanes.children.forEach((plane, i) => (plane.rotation.z = t * (0.004 + i * 0.002) * (i % 2 ? -1 : 1)));
    const flicker = 1 + Math.sin(t * 7.1) * 0.04 + Math.sin(t * 13.7) * 0.03;
    const glow = this.lanterns.userData['glow'] as THREE.InstancedMesh | undefined;
    if (glow) (glow.material as THREE.MeshBasicMaterial).color.copy(LANTERN_COLOR).multiplyScalar(flicker);
  }

  dispose(): void {
    disposeTree(this.lanterns);
    disposeTree(this.fogPlanes);
    this.moon.shadow.map?.dispose();
  }

  private buildFogPlanes(): void {
    const texture = fogTexture();
    // Nebulosa bajo las islas: capas de bruma índigo y violeta sobre el abismo estrellado.
    for (const [y, size, opacity, color] of [[-70, 1800, 0.5, '#2a2050'], [-130, 2200, 0.4, '#1b2350'], [-4, 900, 0.12, '#3a3466']] as const) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          map: texture, color, transparent: true, opacity, depthWrite: false, fog: false,
        }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = y;
      plane.renderOrder = -1;
      this.fogPlanes.add(plane);
    }
    this.fogPlanes.userData['texture'] = texture;
  }
}

// Faroles de las calzadas: luz fría de energía estelar (lo cálido se reserva para antorchas e interacción).
const LANTERN_COLOR = new THREE.Color(PALETTE.energy).multiplyScalar(3); // HDR: supera el umbral del bloom
const LANTERN_EVERY = 28;

/** Dirección hacia la luna: la usan la luz direccional y el cielo procedural (la misma en ambos). */
export function moonDirection(): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(MOON_ELEVATION) * Math.cos(MOON_AZIMUTH),
    Math.sin(MOON_ELEVATION),
    Math.cos(MOON_ELEVATION) * Math.sin(MOON_AZIMUTH),
  );
}

function buildLanterns(places: Place[]): THREE.Group {
  const group = new THREE.Group();
  const agora = places.find((p) => p.id === AGORA_ID);
  const spots: THREE.Vector3[] = [];
  for (const place of places) {
    if (place.kind === 'agora' || !agora) continue;
    const d = Math.hypot(place.x, place.z) || 1;
    const ux = place.x / d;
    const uz = place.z / d;
    const side = BRIDGE_WIDTH / 2 + 0.7; // sobre los pretiles
    // A lo largo de toda la calzada, a ambos lados, alternados: marcan el camino en la oscuridad.
    for (let along = agora.radius + 6, i = 0; along < d - place.radius - 4; along += LANTERN_EVERY / 2, i++) {
      const s = i % 2 ? 1 : -1;
      spots.push(new THREE.Vector3(ux * along - uz * side * s, 0.7, uz * along + ux * side * s));
    }
  }
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.16, 4, 5).translate(0, 2, 0),
    new THREE.MeshLambertMaterial({ color: '#3c3a45' }),
    spots.length,
  );
  const glow = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.32, 0).translate(0, 4.3, 0),
    new THREE.MeshBasicMaterial({ color: LANTERN_COLOR.clone() }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    posts.setMatrixAt(i, m);
    glow.setMatrixAt(i, m);
  });
  posts.castShadow = false;
  group.add(posts, glow);
  group.userData['glow'] = glow;
  return group;
}

/** Bruma: manchas radiales suaves en un canvas pequeño (sin ruido por fotograma). */
function fogTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Borde transparente: el plano no muestra su contorno.
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}
