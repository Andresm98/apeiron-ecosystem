import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_BUDGET_MS, HUD_CONTRAST_PAIRS, HUD_TOKENS, PALETTE, QualityGovernor, agentTone, contrastRatio, desaturate,
  initialQuality, lowerQuality, mix, overBudget, renderSettings,
} from './atmosphere.ts';

const saturation = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(r, g, b) - Math.min(r, g, b);
};

test('agent colours are muted at rest and full only while acting', () => {
  const heraclito = '#e0663a';
  assert.equal(agentTone(heraclito, true), heraclito);
  assert.ok(saturation(agentTone(heraclito, false)) < saturation(heraclito) * 0.3);
  assert.equal(saturation(desaturate('#e0663a', 0)), 0);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('every HUD text/background pair meets WCAG AA (4.5:1)', () => {
  for (const [text, background] of HUD_CONTRAST_PAIRS) {
    const ratio = contrastRatio(HUD_TOKENS[text], HUD_TOKENS[background]);
    assert.ok(ratio >= 4.5, `${text} sobre ${background}: ${ratio}`);
  }
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
});

test('the world palette stays dark: fog and the void sit near the abyss', () => {
  assert.ok(contrastRatio(PALETTE.fog, PALETTE.abyss) < 1.3);
  assert.ok(contrastRatio(PALETTE.murk, PALETTE.abyss) < 1.4);
  assert.ok(contrastRatio(PALETTE.lamp, PALETTE.fog) > 7); // la luz cálida destaca contra el frío
});

test('initial quality: URL beats choice, touch starts low, desktop medium', () => {
  assert.equal(initialQuality({ coarse: false }), 'medium');
  assert.equal(initialQuality({ coarse: true }), 'low');
  assert.equal(initialQuality({ coarse: true, chosen: 'high' }), 'high');
  assert.equal(initialQuality({ coarse: false, chosen: 'high', forced: 'low' }), 'low'); // CI
  assert.equal(initialQuality({ coarse: false, chosen: 'ultra' }), 'medium');
  assert.equal(lowerQuality('low'), null);
});

test('the governor drops one level after a slow 3 s window and never climbs back', () => {
  const governor = new QualityGovernor('high');
  let change: string | null = null;
  for (let t = 0; t < 3000 && !change; t += 30) change = governor.sample(30); // ~33 fps
  assert.equal(change, 'medium');
  for (let t = 0; t < 3000; t += 10) assert.equal(governor.sample(10), null); // rápido de nuevo: no sube
  assert.equal(governor.current, 'medium');
  const fine = new QualityGovernor('medium');
  for (let t = 0; t < 6000; t += FRAME_BUDGET_MS - 1) assert.equal(fine.sample(FRAME_BUDGET_MS - 1), null);
  const fixed = new QualityGovernor('high', false);
  for (let t = 0; t < 6000; t += 50) assert.equal(fixed.sample(50), null); // nivel elegido a mano
});

test('render settings follow the ADR table and keep the scene legible', () => {
  const free = { focusLocked: false, reducedMotion: false };
  const low = renderSettings('low', free);
  assert.equal(low.composer, false);
  assert.equal(low.shadowMapSize, 0);
  assert.equal(low.dof, null);
  assert.equal(low.pixelRatioMax, 1);
  assert.ok(low.stardust < renderSettings('medium', free).stardust && renderSettings('medium', free).stardust < renderSettings('high', free).stardust);
  const medium = renderSettings('medium', free);
  assert.equal(medium.shadowMapSize, 1024);
  assert.ok(medium.vignette && medium.bloom && medium.grading);
  assert.equal(medium.dof, null);
  const high = renderSettings('high', free);
  assert.equal(high.shadowMapSize, 2048);
  assert.ok(high.dof && high.grain);
  // Durante una deliberación, un diálogo o tu turno no hay desenfoque; con movimiento reducido, ni DoF ni grano.
  assert.equal(renderSettings('high', { focusLocked: true, reducedMotion: false }).dof, null);
  const calm = renderSettings('high', { focusLocked: false, reducedMotion: true });
  assert.equal(calm.dof, null);
  assert.equal(calm.grain, null);
  assert.equal(calm.waterMotion, false);
});

test('overBudget reports draw calls and triangles against the 5.7 budgets', () => {
  assert.deepEqual(overBudget({ fps: 60, frameMs: 16, calls: 70, triangles: 1000, textures: 2, quality: 'low' }), []);
  assert.equal(overBudget({ fps: 60, frameMs: 16, calls: 90, triangles: 1000, textures: 2, quality: 'low' }).length, 1);
  assert.equal(overBudget({ fps: 60, frameMs: 16, calls: 120, triangles: 400_000, textures: 2, quality: 'high' }).length, 1);
});
