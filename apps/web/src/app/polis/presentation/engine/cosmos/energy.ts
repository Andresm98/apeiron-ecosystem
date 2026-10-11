import * as THREE from 'three';

/** Reloj compartido por todos los materiales con energía: un solo valor que el motor avanza cada fotograma. */
export const energyClock = { value: 0 };

let crackTexture: THREE.CanvasTexture | null = null;

/**
 * Grietas ramificadas pintadas una vez en un canvas (blanco sobre negro, con halo). Se usa como `emissiveMap`: lo
 * blanco brilla con el color de la energía y lo negro queda en piedra.
 */
export function cracks(): THREE.CanvasTexture {
  if (crackTexture) return crackTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  let seed = 271;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number) => {
    let cx = x;
    let cy = y;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const steps = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 0.9;
      cx += Math.cos(angle) * (length / steps);
      cy += Math.sin(angle) * (length / steps);
      ctx.lineTo(cx, cy);
      if (depth > 0 && rand() < 0.22) branch(cx, cy, angle + (rand() > 0.5 ? 1 : -1) * (0.6 + rand() * 0.6), length * 0.45, width * 0.6, depth - 1);
    }
    ctx.lineWidth = width;
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Halo ancho y tenue, luego el filo brillante: la grieta parece emitir desde dentro.
  for (const [width, alpha, blur] of [[7, 0.18, 10], [2.2, 0.9, 2]] as const) {
    seed = 271;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = blur;
    for (let i = 0; i < 9; i++) {
      // Grietas que cruzan el tile de punta a punta (en vertical): continúan en el tile siguiente.
      branch(rand() * size, -10, Math.PI / 2 + (rand() - 0.5) * 0.5, size * (0.6 + rand() * 0.6), width * (0.7 + rand() * 0.6), 2);
    }
  }
  crackTexture = new THREE.CanvasTexture(canvas);
  crackTexture.wrapS = THREE.RepeatWrapping;
  crackTexture.wrapT = THREE.RepeatWrapping;
  crackTexture.colorSpace = THREE.SRGBColorSpace;
  crackTexture.anisotropy = 4;
  return crackTexture;
}

/**
 * Piedra con grietas de energía estelar: Lambert con `emissiveMap` de grietas y pulsos que recorren el eje V del
 * UV (a lo largo de los puentes). El emisivo supera el umbral del bloom: las grietas brillan en la penumbra.
 */
export function energyStone(stone: string, energy: string, intensity = 2.2, flow = 1.4): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: stone,
    emissive: energy,
    emissiveIntensity: intensity,
    emissiveMap: cracks(),
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uEnergyTime'] = energyClock;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEnergyTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Pulsos de energía que fluyen a lo largo de las grietas, más un latido lento de fondo.
        float pulse = pow(0.5 + 0.5 * sin(vEmissiveMapUv.y * 7.0 - uEnergyTime * ${flow.toFixed(2)}), 6.0);
        totalEmissiveRadiance *= 0.35 + 0.25 * sin(uEnergyTime * 0.7) + 1.6 * pulse;`,
      );
  };
  material.customProgramCacheKey = () => `energy-${flow}`;
  return material;
}

/** Escala la UV de una geometría para que la textura de grietas se repita según su tamaño real (m por tile). */
export function tileUv(geometry: THREE.BufferGeometry, repeatU: number, repeatV: number): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i) * repeatV);
  uv.needsUpdate = true;
  return geometry;
}
