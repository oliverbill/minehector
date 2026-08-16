// Posse dos blocos: quem escreveu numa célula é dono dela, e só o dono escreve
// de novo ali. Os dois lados da regra são testados pelo caminho real — o clique
// passa pela Interaction, a obra passa pelo BuildJob — porque é fiação errada
// entre eles, e não a regra em si, que deixa a casa dos bots demolível.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { World } from '../js/world/world.js';
import { Blocks, Owner, WORLD_SEED } from '../js/constants.js';
import { BuildJob, Village } from '../js/bots/village.js';
import { planStructure } from '../js/world/structures.js';
import { flatWorld, scene, aimAt } from './harness.mjs';

// Obra pronta de um tipo fixo, assentada até o fim num platô.
function casaDeBot(world, origin, kind = 'cabana') {
  const plan = planStructure(kind, () => 0.5);
  const job = new BuildJob(world, origin, plan);
  for (let i = 0; i < 2000 && !job.done; i++) job.step(1, []);
  assert(job.done, 'a obra não terminou');
  return { plan, job };
}

// Primeira célula sólida da casa, em coordenadas de mundo.
function umBlocoDaCasa(world, plan, origin) {
  for (const [x, y, z, id] of plan.blocks) {
    if (id === Blocks.AIR) continue;
    const c = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
    if (world.isSolid(c.x, c.y, c.z)) return c;
  }
  return null;
}

// Bloco da parede da frente exposto ao lado de fora (-Z), na altura do peito de
// quem está no chão. É o único que serve para testar o clique: um bloco do miolo
// não tem linha de visada, e mirar o que não se vê não prova nada.
function paredeDaFrente(world, plan, origin) {
  let melhor = null;
  for (const [x, y, z, id] of plan.blocks) {
    if (id === Blocks.AIR || y !== 1) continue;
    const c = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
    if (!world.isSolid(c.x, c.y, c.z)) continue;
    if (world.isSolid(c.x, c.y, c.z - 1)) continue;   // tapado por fora
    if (!melhor || c.z < melhor.z) melhor = c;
  }
  return melhor;
}

test('o jogador não quebra bloco que o bot assentou', () => {
  const { world, floor } = flatWorld(40, 48);
  const origin = { x: 14, y: floor, z: 14 };
  const { plan } = casaDeBot(world, origin);

  const alvo = umBlocoDaCasa(world, plan, origin);
  assert(alvo, 'a casa não deixou bloco sólido nenhum');
  assertEqual(world.ownerOf(alvo.x, alvo.y, alvo.z), Owner.BOT, 'dono do bloco da casa');

  const antes = world.getBlock(alvo.x, alvo.y, alvo.z);
  const ok = world.setBlock(alvo.x, alvo.y, alvo.z, Blocks.AIR, Owner.PLAYER);
  assertEqual(ok, false, 'a escrita do jogador devia ter sido recusada');
  assertEqual(world.getBlock(alvo.x, alvo.y, alvo.z), antes, 'o bloco mudou mesmo assim');
});

test('o clique de quebrar não derruba a casa, e o de colocar não tapa a porta', () => {
  const { world, floor } = flatWorld(40, 48);
  const origin = { x: 20, y: floor, z: 20 };
  const { plan } = casaDeBot(world, origin);

  // Quebrar: mira um bloco da casa de perto e clica, como o jogador faz.
  const alvo = paredeDaFrente(world, plan, origin);
  assert(alvo, 'a casa não tem parede exposta para mirar');
  const ctx = scene(world, { x: alvo.x + 0.5, y: floor, z: alvo.z - 2.5 });
  ctx.player.yaw = Math.PI;   // a frente da planta é -Z, e o jogador nasce olhando para -Z
  const hit = aimAt(ctx, alvo);
  assert(hit, 'não foi possível mirar o bloco da casa — o teste não provaria nada');
  ctx.click(0);
  assert(world.isSolid(alvo.x, alvo.y, alvo.z), 'o clique derrubou o bloco do bot');

  // Colocar: o vão da porta é ar do bot, e ar do bot também é da casa.
  const porta = plan.door;
  assert(porta, 'a planta não tem porta');
  const cell = { x: origin.x + porta.x, y: origin.y + 1, z: origin.z + porta.z };
  assertEqual(world.ownerOf(cell.x, cell.y, cell.z), Owner.BOT, 'dono do vão da porta');
  assertEqual(world.setBlock(cell.x, cell.y, cell.z, Blocks.STONE, Owner.PLAYER), false,
    'o jogador tapou a porta da casa alheia');
  assertEqual(world.getBlock(cell.x, cell.y, cell.z), Blocks.AIR, 'a porta deixou de ser vão');
});

test('a obra do bot não passa por cima do que o jogador construiu', () => {
  const { world, floor } = flatWorld(40, 48);

  // Uma parede do jogador bem no meio de onde a casa iria.
  const origin = { x: 16, y: floor, z: 16 };
  const plan = planStructure('cabana', () => 0.5);
  const meus = [];
  for (let i = 0; i < 4; i++) {
    const c = { x: origin.x + 2 + i, y: origin.y + 1, z: origin.z + 2 };
    world.setBlock(c.x, c.y, c.z, Blocks.WOOD, Owner.PLAYER);
    meus.push(c);
  }

  const job = new BuildJob(world, origin, plan);
  for (let i = 0; i < 2000 && !job.done; i++) job.step(1, []);

  for (const c of meus) {
    assertEqual(world.getBlock(c.x, c.y, c.z), Blocks.WOOD, `o bot mexeu em (${c.x},${c.y},${c.z})`);
    assertEqual(world.ownerOf(c.x, c.y, c.z), Owner.PLAYER, 'a posse do jogador se perdeu');
  }
});

test('a aldeia não escolhe sítio em cima de construção do jogador', () => {
  const world = new World(WORLD_SEED, new Map());
  const spawn = { x: 8.5, z: 8.5 };

  // Marca como do jogador uma faixa larga em volta do centro: toda planta que
  // caísse ali encostaria em pelo menos uma célula dele.
  for (let x = -30; x <= 30; x++) {
    for (let z = -30; z <= 30; z++) {
      const y = world.surfaceHeight(x, z);
      if (y > 0) world.setBlock(x, y + 1, z, Blocks.WOOD, Owner.PLAYER);
    }
  }

  const village = new Village(world, spawn, () => 0.5);
  const job = village.planNear(8, 8);
  assertEqual(job, null, 'a aldeia planejou obra em cima do terreno do jogador');
  assertEqual(village.structures.length, 0, 'registrou construção sem poder construir');
});

test('quem quebra também assina: a célula esvaziada continua sendo dele', () => {
  const { world, floor } = flatWorld(40, 32);
  const c = { x: 5, y: floor, z: 5 };

  world.setBlock(c.x, c.y, c.z, Blocks.WOOD, Owner.PLAYER);
  assertEqual(world.ownerOf(c.x, c.y, c.z), Owner.PLAYER, 'não ficou do jogador');

  // O bot esbarra nela enquanto é do jogador...
  assertEqual(world.setBlock(c.x, c.y, c.z, Blocks.STONE, Owner.BOT), false, 'o bot passou por cima');

  // ...e continua sendo do jogador depois que ele mesmo a esvazia: quem quebra
  // também assina a célula. Só assim um buraco cavado por ele não vira alicerce
  // de bot no minuto seguinte.
  assertEqual(world.setBlock(c.x, c.y, c.z, Blocks.AIR, Owner.PLAYER), true, 'não quebrou o próprio bloco');
  assertEqual(world.ownerOf(c.x, c.y, c.z), Owner.PLAYER, 'a célula vazia perdeu o dono');
  assertEqual(world.setBlock(c.x, c.y, c.z, Blocks.STONE, Owner.BOT), false, 'o bot ocupou o buraco alheio');
});

test('terreno virgem não tem dono e aceita os dois', () => {
  const { world, floor } = flatWorld(40, 32);
  assertEqual(world.ownerOf(3, floor + 3, 3), Owner.NONE, 'terreno nasceu com dono');
  assertEqual(world.setBlock(3, floor + 3, 3, Blocks.STONE, Owner.BOT), true, 'o bot não pôde construir no vazio');
  assertEqual(world.setBlock(4, floor + 3, 3, Blocks.STONE, Owner.PLAYER), true, 'o jogador não pôde construir no vazio');
});
