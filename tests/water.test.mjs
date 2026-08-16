// Água: o único bloco que não é parede. O que se afirma aqui é o que muda por
// causa disso — física, mira, meshing e o chão medido pelo mundo — porque cada
// um desses lugares perguntava "é AIR?" e agora tem um terceiro caso.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { Blocks, Owner, isSolidBlock } from '../js/constants.js';
import { buildChunkMesh } from '../js/render/mesher.js';
import { moveEntity, inWater, WATER_SINK } from '../js/player/physics.js';
import { raycastVoxel } from '../js/player/raycast.js';
import { flatWorld, scene, aimAt } from './harness.mjs';

// Piscina cavada no platô: buraco de `prof` blocos cheio de água até a borda.
function piscina(world, floor, x0, z0, lado = 4, prof = 3) {
  for (let x = x0; x < x0 + lado; x++) {
    for (let z = z0; z < z0 + lado; z++) {
      for (let d = 1; d <= prof; d++) {
        world.setBlock(x, floor - d, z, Blocks.AIR, Owner.PLAYER);
        world.setBlock(x, floor - d, z, Blocks.WATER, Owner.PLAYER);
      }
    }
  }
}

const corpo = (x, y, z) => ({
  pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
  width: 0.6, height: 1.8, onGround: false,
});

test('água ocupa a célula mas não é parede', () => {
  const { world, floor } = flatWorld(40, 32);
  world.setBlock(5, floor, 5, Blocks.WATER);
  assertEqual(world.getBlock(5, floor, 5), Blocks.WATER, 'a água não ficou no mundo');
  assertEqual(world.isSolid(5, floor, 5), false, 'a água virou parede');
  assertEqual(world.isWater(5, floor, 5), true, 'isWater não reconheceu');
  assertEqual(world.isTargetable(5, floor, 5), true, 'a mira não enxerga a água');
  assertEqual(isSolidBlock(Blocks.WATER), false, 'isSolidBlock diz que água é sólida');
});

test('o chão do mundo ignora a água: nada nasce em cima do lago', () => {
  const { world, floor } = flatWorld(40, 32);
  assertEqual(world.surfaceHeight(6, 6), floor - 1, 'chão do platô');
  world.setBlock(6, floor, 6, Blocks.WATER);
  world.setBlock(6, floor + 1, 6, Blocks.WATER);
  assertEqual(world.surfaceHeight(6, 6), floor - 1, 'a água virou superfície');
});

test('quem entra na água afunda devagar em vez de despencar', () => {
  const { world, floor } = flatWorld(40, 32);
  // Coluna de água alta, para medir a queda sem ninguém chegar ao fundo. Comparar
  // com quem cai num buraco não diria nada: o do buraco fica mais baixo porque o
  // chão dele é mais fundo, não porque caiu mais rápido.
  for (let y = floor; y < floor + 16; y++) world.setBlock(5, y, 5, Blocks.WATER);
  for (let y = floor; y < floor + 16; y++) world.setBlock(6, y, 5, Blocks.WATER);

  const alturaInicial = floor + 10;
  const seco = corpo(20.5, alturaInicial, 20.5);
  const molhado = corpo(5.5, alturaInicial, 5.5);
  for (let f = 0; f < 24; f++) {
    moveEntity(world, seco, 1 / 60);
    moveEntity(world, molhado, 1 / 60);
  }

  assert(inWater(world, molhado), 'o corpo não está na água');
  assertEqual(molhado.inWater, true, 'a flag inWater não foi marcada');
  assert(!seco.onGround && !molhado.onGround, 'alguém já pousou — a medição não vale');

  const quedaSeca = alturaInicial - seco.pos.y;
  const quedaMolhada = alturaInicial - molhado.pos.y;
  assert(quedaMolhada < quedaSeca * 0.5,
    `caiu ${quedaMolhada.toFixed(2)} na água contra ${quedaSeca.toFixed(2)} no ar`);
  assert(-molhado.vel.y <= WATER_SINK + 1e-6, `afundou a ${-molhado.vel.y.toFixed(1)} b/s`);
});

test('dentro da piscina dá para descer até o fundo — o buraco continua vazio', () => {
  const { world, floor } = flatWorld(40, 32);
  piscina(world, floor, 4, 4, 4, 3);

  const e = corpo(5.5, floor + 2, 5.5);
  for (let f = 0; f < 60 * 8; f++) moveEntity(world, e, 1 / 60);

  // Fundo do buraco: o piso sólido está em floor-4, então os pés param em floor-3.
  assert(e.pos.y < floor - 2.5, `parou em y=${e.pos.y.toFixed(2)}, devia ter afundado`);
  assert(e.onGround, 'não encostou no fundo da piscina');
});

test('a mira acerta a água (senão não há como desfazer a piscina)', () => {
  const { world, floor } = flatWorld(40, 32);
  world.setBlock(8, floor, 8, Blocks.WATER);

  const olho = { x: 8.5, y: floor + 0.5, z: 4.5 };
  const dir = { x: 0, y: 0, z: 1 };
  const soSolido = raycastVoxel(world, olho, dir, 8);
  const comAgua = raycastVoxel(world, olho, dir, 8, (w, x, y, z) => w.isTargetable(x, y, z));

  assert(!soSolido || soSolido.block.z !== 8, 'o raio padrão parou na água');
  assert(comAgua, 'o raio da mira não achou nada');
  assertEqual(comAgua.block.z, 8, 'a mira atravessou a água');
});

test('o clique quebra a água mirada e a célula esvazia', () => {
  const { world, floor } = flatWorld(40, 32);
  world.setBlock(10, floor, 10, Blocks.WATER);

  const ctx = scene(world, { x: 10.5, y: floor, z: 7.5 });
  ctx.player.yaw = Math.PI;   // olhar para +Z
  const hit = aimAt(ctx, { x: 10, y: floor, z: 10 });
  assert(hit, 'não consegui mirar a água');
  ctx.click(0);
  assertEqual(world.getBlock(10, floor, 10), Blocks.AIR, 'a água não foi removida');
});

test('o mesher separa a água e não desenha parede dentro do volume', () => {
  const { world, floor } = flatWorld(40, 32);
  const get = (x, y, z) => world.getBlock(x, y, z);
  const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

  const seco = buildChunkMesh(get, 0, 0, uv);
  assertEqual(seco.water.indices.length, 0, 'apareceu água num chunk sem água');
  assert(seco.opaque.indices.length > 0, 'o chunk opaco saiu vazio');

  piscina(world, floor, 4, 4, 4, 2);
  const molhado = buildChunkMesh(get, 0, 0, uv);
  assert(molhado.water.indices.length > 0, 'a piscina não gerou geometria de água');

  // Duas águas vizinhas não fazem face entre si: 4x4x2 de água só pode mostrar
  // a superfície e as laterais expostas, nunca os planos internos.
  const facesAgua = molhado.water.indices.length / 6;
  assert(facesAgua <= 4 * 4 + 4 * 4 * 2 + 8,
    `${facesAgua} faces de água — está desenhando o interior do volume`);
});

test('bloco sólido ao lado da água continua tendo face (o fundo não some)', () => {
  const { world, floor } = flatWorld(40, 32);
  const get = (x, y, z) => world.getBlock(x, y, z);
  const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

  const antes = buildChunkMesh(get, 0, 0, uv).opaque.indices.length;
  // Cava uma célula e enche de água: o chão em volta ganha as faces expostas.
  world.setBlock(5, floor - 1, 5, Blocks.WATER, Owner.PLAYER);
  const depois = buildChunkMesh(get, 0, 0, uv).opaque.indices.length;

  assert(depois > antes, 'a parede do buraco cheio de água não gerou face nenhuma');
});
