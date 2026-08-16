// Contrato do raycast. O `t` entrou porque a colocação precisa saber em que
// ponto da face se mirou; se ele voltar a sair, ou passar a medir outra coisa,
// empilhar quebra de novo — e quebra em silêncio.

import { test, assert } from './tiny-test.mjs';
import { raycastVoxel } from '../js/player/raycast.js';
import { flatWorld, buildColumn, Blocks } from './harness.mjs';

const norm = (v) => {
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

test('t leva exatamente até a face atingida', () => {
  const { world, floor } = flatWorld();
  buildColumn(world, 8, 6, floor, 4);
  const origin = { x: 8.5, y: floor + 1.62, z: 9.3 };
  for (let d = -60; d <= 80; d += 3) {
    const rad = (d * Math.PI) / 180;
    const dir = norm({ x: 0, y: Math.sin(rad), z: -Math.cos(rad) });
    const hit = raycastVoxel(world, origin, dir, 6);
    if (!hit || hit.t === 0) continue;
    const p = {
      x: origin.x + dir.x * hit.t,
      y: origin.y + dir.y * hit.t,
      z: origin.z + dir.z * hit.t,
    };
    // O ponto cai na face: uma coordenada encosta no plano do bloco, as outras
    // ficam dentro dele.
    const plano =
      (hit.normal.x !== 0 && Math.abs(p.x - (hit.block.x + (hit.normal.x > 0 ? 1 : 0))) < 1e-9) ||
      (hit.normal.y !== 0 && Math.abs(p.y - (hit.block.y + (hit.normal.y > 0 ? 1 : 0))) < 1e-9) ||
      (hit.normal.z !== 0 && Math.abs(p.z - (hit.block.z + (hit.normal.z > 0 ? 1 : 0))) < 1e-9);
    assert(plano, `pitch ${d}: origin+dir*t não caiu no plano da face`);
    assert(p.y >= hit.block.y - 1e-9 && p.y <= hit.block.y + 1 + 1e-9,
      `pitch ${d}: ponto fora da altura do bloco atingido`);
    assert(hit.t <= 6 + 1e-9, `pitch ${d}: t=${hit.t} passou do alcance pedido`);
  }
});

test('prev é sempre a célula do lado da normal e nunca é sólida', () => {
  const { world, floor } = flatWorld();
  buildColumn(world, 8, 6, floor, 3);
  const origin = { x: 8.5, y: floor + 1.62, z: 9.3 };
  let vistos = 0;
  for (let d = -80; d <= 80; d += 2) {
    const rad = (d * Math.PI) / 180;
    const dir = norm({ x: 0, y: Math.sin(rad), z: -Math.cos(rad) });
    const hit = raycastVoxel(world, origin, dir, 6);
    if (!hit || hit.t === 0) continue;
    vistos++;
    assert(hit.prev.x === hit.block.x + hit.normal.x
      && hit.prev.y === hit.block.y + hit.normal.y
      && hit.prev.z === hit.block.z + hit.normal.z, `pitch ${d}: prev não é block+normal`);
    assert(!world.isSolid(hit.prev.x, hit.prev.y, hit.prev.z), `pitch ${d}: prev é sólida`);
    assert(world.isSolid(hit.block.x, hit.block.y, hit.block.z), `pitch ${d}: block não é sólido`);
  }
  assert(vistos > 20, `varredura fraca: ${vistos} acertos`);
});

test('sem nada no alcance devolve null', () => {
  const world = flatWorld().world;
  for (let y = 0; y < 64; y++) world.setBlock(8, y, 8, Blocks.AIR);
  const hit = raycastVoxel(world, { x: 8.5, y: 50, z: 8.5 }, { x: 0, y: 1, z: 0 }, 6);
  assert(hit === null, 'devolveu alvo onde só há ar');
});
