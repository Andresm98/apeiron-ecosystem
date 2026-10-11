import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { AnimatorFrame, Stride } from './animator';
import { CharacterMotion, PlayerAvatar, decorations, groundDecorations } from './character';
import { RiggedModel, loadRig } from './rigged-model';

const HEIGHT = 2.5;

/**
 * ssanax desde un glTF riggeado (Blender o Mixamo), con la figura que haya elegido el jugador: la misma máquina de
 * estados que el procedural, aplicada a un `RiggedModel`. Se escala a 2,5 m y se apoya en el suelo, sea cual sea la
 * escala de exportación.
 */
export class GltfAvatar implements PlayerAvatar {
  readonly root = new THREE.Group();
  readonly halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly label: CSS2DObject;
  /** Metros por ciclo de sus clips (`extras.apeiron.stride` de la escena, en alturas del modelo); si no, el del rig. */
  readonly stride: Stride | undefined;
  private readonly contact: THREE.Mesh;
  private readonly rig: RiggedModel;

  private constructor(readonly figure: string, rig: RiggedModel, name: string) {
    this.rig = rig;
    this.stride = rig.stride;
    const deco = decorations(name);
    this.halo = deco.halo;
    this.contact = deco.contact;
    this.label = deco.label;
    this.root.add(rig.object, this.halo, this.contact, this.label);
  }

  /** Carga la figura `figure` (`<figure>.glb` con al menos `Idle` y `Walk`). */
  static async load(figure: string, name: string): Promise<GltfAvatar> {
    return new GltfAvatar(figure, new RiggedModel(await loadRig(figure), HEIGHT), name);
  }

  apply(frame: AnimatorFrame, motion: CharacterMotion): void {
    this.rig.apply(frame.weights, motion.dt);
    groundDecorations(this.root, this.halo, this.contact);
  }

  dispose(): void {
    this.rig.dispose(); // geometría y materiales son de la plantilla compartida: no se liberan aquí
    this.halo.geometry.dispose();
    this.halo.material.dispose();
    this.label.element.remove();
  }
}
