import {
  BloomEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, NoiseEffect, RenderPass, ToneMappingEffect,
  ToneMappingMode, VignetteEffect, BlendFunction,
} from 'postprocessing';
import * as THREE from 'three';
import { RenderSettings } from '../../../domain/atmosphere';

/**
 * Color grading de claroscuro: contraste fílmico alrededor del gris medio, saturación contenida y *split toning*
 * (sombras hacia el verde frío del agua, luces hacia la lámpara). Un solo `mainImage`, sin LUT (ADR-013 §5.3).
 */
const GRADE_SHADER = /* glsl */ `
uniform float contrast;
uniform float saturation;
uniform float split;
uniform vec3 shadowTint;
uniform vec3 highlightTint;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = pow(c / 0.18 + 1e-5, vec3(contrast)) * 0.18;
  vec3 tint = mix(shadowTint, highlightTint, smoothstep(0.02, 0.6, l));
  c = mix(c, c * tint / max(dot(tint, vec3(0.3333)), 1e-3), split);
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_SHADER, {
      uniforms: new Map<string, THREE.Uniform>([
        ['contrast', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['split', new THREE.Uniform(0)],
        ['shadowTint', new THREE.Uniform(new THREE.Color('#1c2730'))],
        ['highlightTint', new THREE.Uniform(new THREE.Color('#ffcf94'))],
      ]),
    });
  }

  set(grading: NonNullable<RenderSettings['grading']>): void {
    this.uniforms.get('contrast')!.value = grading.contrast;
    this.uniforms.get('saturation')!.value = grading.saturation;
    this.uniforms.get('split')!.value = grading.split;
  }
}

/**
 * Post-proceso de la Polis (ADR-013 §5.3). En nivel bajo no hay composer: el renderer hace el tone mapping AgX y
 * dibuja directo. En medio y alto, un `EffectComposer` en HDR (HalfFloat) con un `EffectPass` que fusiona bloom,
 * tone mapping, grading, viñeta y grano en un solo shader; la profundidad de campo va en su propio pase previo.
 */
export class PostPipeline {
  private composer: EffectComposer | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private signature = '';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Reconstruye la cadena solo si cambia su forma; los parámetros sueltos se aplican sin recompilar. */
  configure(settings: RenderSettings): void {
    this.renderer.toneMappingExposure = settings.exposure;
    const signature = JSON.stringify([settings.composer, !!settings.dof, !!settings.bloom, !!settings.vignette, !!settings.grading, !!settings.grain]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.disposeComposer();
    if (!settings.composer) {
      this.renderer.toneMapping = THREE.AgXToneMapping;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping; // lo hace ToneMappingEffect, después del bloom en HDR
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (settings.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, { worldFocusRange: settings.dof.focusRange, bokehScale: settings.dof.bokehScale });
      this.dof.target = new THREE.Vector3();
      composer.addPass(new EffectPass(this.camera, this.dof));
    }
    const effects: Effect[] = [];
    if (settings.bloom) {
      effects.push(new BloomEffect({
        intensity: settings.bloom.intensity,
        luminanceThreshold: settings.bloom.threshold,
        luminanceSmoothing: settings.bloom.smoothing,
        mipmapBlur: true,
      }));
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
    if (settings.grading) {
      const grade = new GradeEffect();
      grade.set(settings.grading);
      effects.push(grade);
    }
    if (settings.vignette) effects.push(new VignetteEffect(settings.vignette));
    if (settings.grain) {
      const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      noise.blendMode.opacity.value = settings.grain;
      effects.push(noise);
    }
    composer.addPass(new EffectPass(this.camera, ...effects));
    this.composer = composer;
    this.resize();
  }

  /** Punto de foco de la profundidad de campo: ssanax. */
  focus(point: THREE.Vector3): void {
    this.dof?.target?.copy(point);
  }

  resize(): void {
    if (!this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setSize(size.x, size.y, false);
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposeComposer();
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.dof = null;
  }
}
