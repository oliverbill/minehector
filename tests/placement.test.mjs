// Regressão da colocação de bloco. O que estes testes seguram, em uma frase:
// empilhar tem de subir olhando de baixo, de qualquer distância; e nada disso
// pode custar as colocações normais nem deixar um bloco dentro do jogador.

import { test, assert, assertEqual } from './tiny-test.mjs';
import {
  Blocks, flatWorld, scene, buildColumn, columnHeight,
  aimAt, hitHeightInBlock, cellHitsPlayer, jumpAndPlace,
} from './harness.mjs';

// Empilha clicando: mira o bloco do topo da coluna e clica, n vezes.
// Devolve a altura alcançada.
function stack(ctx, cx, cz, floor, clicks) {
  const { world } = ctx;
  for (let i = 0; i < clicks; i++) {
    const h = columnHeight(world, cx, cz, floor);
    const alvo = h === 0 ? { x: cx, y: floor - 1, z: cz } : { x: cx, y: floor + h - 1, z: cz };
    if (!aimAt(ctx, alvo)) break;
    ctx.click(2);
    if (columnHeight(world, cx, cz, floor) === h) break; // não subiu: acabou
  }
  return columnHeight(world, cx, cz, floor);
}

function setup(spawnZ = 8.5) {
  const { world, floor } = flatWorld();
  const ctx = scene(world, { x: 8.5, y: floor, z: spawnZ });
  ctx.world = world;
  ctx.floor = floor;
  ctx.player.yaw = 0; // olhando para -Z
  return ctx;
}

// --- o bug relatado -------------------------------------------------------

test('coluna à frente passa de 2 blocos (era o teto do bug)', () => {
  const ctx = setup();
  const h = stack(ctx, 8, 6, ctx.floor, 6);
  assert(h > 2, `coluna parou em ${h} bloco(s)`);
});

test('coluna sobe até o alcance, de qualquer distância', () => {
  // A primeira correção só funcionava colado na coluna; de longe o bloco ia para
  // o lado. Cada folga aqui é uma posição de jogo real.
  for (const folga of [0, 0.2, 0.5, 1, 2]) {
    const ctx = setup(7.0 + folga + 0.3); // 0,3 = meia largura do corpo
    const h = stack(ctx, 8, 6, ctx.floor, 8);
    assert(h >= 5, `com folga ${folga} a coluna parou em ${h} bloco(s)`);
  }
});

test('empilhar não exige andar: o jogador não sai do lugar', () => {
  const ctx = setup(9.3);
  const antes = { ...ctx.player.pos };
  stack(ctx, 8, 6, ctx.floor, 5);
  assertEqual(ctx.player.pos.x, antes.x, 'x');
  assertEqual(ctx.player.pos.z, antes.z, 'z');
});

test('acima da cabeça continua subindo (não vira bloco solto ao lado)', () => {
  const ctx = setup(9.3);
  const { world, floor } = ctx;
  buildColumn(world, 8, 6, floor, 3);           // topo já acima do olho
  const antes = columnHeight(world, 8, 6, floor);
  const h = stack(ctx, 8, 6, floor, 3);
  assert(h > antes, `coluna ficou em ${h}, começou em ${antes}`);
  // e nada foi parar na vertical do jogador
  for (let y = floor; y < floor + 8; y++) {
    assert(!world.isSolid(8, y, 9), `bloco solto em (8,${y},9), a prumo do jogador`);
  }
});

// --- o que a regra não pode custar ---------------------------------------

test('mirar a metade de baixo da face coloca ao lado (parede horizontal)', () => {
  const ctx = setup(9.3);
  const { world, floor } = ctx;
  buildColumn(world, 8, 6, floor, 4);
  const alvo = { x: 8, y: floor + 2, z: 6 };     // bloco acima da cabeça
  const hit = aimAt(ctx, alvo, (h, c) => hitHeightInBlock(c, h) < 0.45);
  assert(hit, 'não achei ângulo que pegasse a metade de baixo da face');
  const antes = columnHeight(world, 8, 6, floor);
  ctx.click(2);
  assertEqual(columnHeight(world, 8, 6, floor), antes, 'a coluna subiu quando não devia');
  assert(world.isSolid(8, floor + 2, 7), 'o bloco não foi para o lado');
});

test('topo ocupado não sobrescreve: o bloco vai para a vizinha de sempre', () => {
  const ctx = setup(9.3);
  const { world, floor } = ctx;
  buildColumn(world, 8, 6, floor, 4);
  const alvo = { x: 8, y: floor + 1, z: 6 };     // bloco do meio: tem coluna em cima
  assert(aimAt(ctx, alvo), 'não consegui mirar o bloco do meio');
  const acima = world.getBlock(8, floor + 2, 6);
  ctx.click(2);
  assertEqual(world.getBlock(8, floor + 2, 6), acima, 'o bloco de cima foi sobrescrito');
  assert(world.isSolid(8, floor + 1, 7), 'o bloco não foi para a vizinha da face');
});

test('colado na coluna e sem topo livre, o clique é recusado', () => {
  const ctx = setup(8.5);                        // corpo encostado na coluna (z=7)
  const { world, floor } = ctx;
  buildColumn(world, 8, 7, floor, 4);
  const alvo = { x: 8, y: floor + 1, z: 7 };     // meio da coluna: topo dele é sólido
  const hit = aimAt(ctx, alvo);
  assert(hit, 'não consegui mirar o bloco do meio');
  assert(ctx.interaction._placementCell(hit) === null, 'aceitou colocar onde não cabe');
  const antes = [];
  for (let y = floor - 1; y < floor + 8; y++) antes.push(world.getBlock(8, y, 7), world.getBlock(8, y, 8));
  ctx.click(2);
  const depois = [];
  for (let y = floor - 1; y < floor + 8; y++) depois.push(world.getBlock(8, y, 7), world.getBlock(8, y, 8));
  assertEqual(JSON.stringify(depois), JSON.stringify(antes), 'algo mudou num clique que devia ser recusado');
});

test('nenhum ângulo consegue colocar um bloco dentro do jogador', () => {
  const ctx = setup(9.3);
  const { world, floor, player, interaction } = ctx;
  buildColumn(world, 8, 6, floor, 5);
  buildColumn(world, 8, 10, floor, 5);           // e uma coluna atrás também
  let testados = 0;
  for (let yaw = 0; yaw < 360; yaw += 15) {
    for (let d = 89; d >= -89; d -= 3) {
      player.yaw = (yaw * Math.PI) / 180;
      player.pitch = (d * Math.PI) / 180;
      interaction.update();
      const hit = interaction._target;
      if (!hit) continue;
      const cell = interaction._placementCell(hit);
      if (!cell) continue;
      testados++;
      assert(!cellHitsPlayer(player, cell),
        `célula (${cell.x},${cell.y},${cell.z}) cai dentro do jogador (yaw ${yaw}, pitch ${d})`);
      assert(!world.isSolid(cell.x, cell.y, cell.z),
        `célula (${cell.x},${cell.y},${cell.z}) já é sólida`);
    }
  }
  assert(testados > 100, `varredura fraca: só ${testados} colocações possíveis`);
});

test('face de cima e face de baixo nunca sobem', () => {
  const ctx = setup();
  const { world, floor, player, interaction } = ctx;
  world.setBlock(8, floor + 2, 8, Blocks.STONE); // teto acima da cabeça
  player.pitch = Math.PI / 2;                    // olhar para cima (Player clampa)
  ctx.click(2);
  assert(!world.isSolid(8, floor + 3, 8), 'subiu por cima de um teto, pela face de baixo');

  // face de cima: chão à frente, olhando para baixo — o bloco vai na vizinha
  player.pitch = -0.6;
  ctx.click(2);
  let achou = false;
  for (let z = 5; z <= 8; z++) if (world.isSolid(8, floor, z)) achou = true;
  assert(achou, 'colocar no chão à frente deixou de funcionar');
});

test('pular e colocar sob os pés continua subindo o pilar', () => {
  const ctx = setup(2.5);
  ctx.player.pos.x = 2.5;
  ctx.player.pitch = -Math.PI / 2;               // reto para baixo (Player clampa)
  const { player, floor } = ctx;
  for (let i = 0; i < 4; i++) {
    assert(jumpAndPlace(ctx), `o pulo ${i + 1} não colocou bloco sob os pés`);
  }
  assertEqual(player.pos.y, floor + 4, 'altura final do pilar');
});

test('quebrar bloco continua sendo o bloco mirado', () => {
  const ctx = setup(9.3);
  const { world, floor } = ctx;
  buildColumn(world, 8, 6, floor, 3);
  const alvo = { x: 8, y: floor + 1, z: 6 };
  assert(aimAt(ctx, alvo), 'não consegui mirar o bloco');
  ctx.click(0);
  assert(!world.isSolid(alvo.x, alvo.y, alvo.z), 'o bloco mirado não foi quebrado');
});

test('nada é colocado além do alcance', () => {
  const ctx = setup();
  const { world, floor, player, interaction } = ctx;
  buildColumn(world, 8, 6, floor, 1);
  player.pitch = 0;
  interaction.update();
  const hit = interaction._target;
  if (!hit) return;
  const dist = Math.hypot(
    hit.block.x + 0.5 - player.eyePos.x,
    hit.block.y + 0.5 - player.eyePos.y,
    hit.block.z + 0.5 - player.eyePos.z,
  );
  assert(dist <= 7, `mirou um bloco a ${dist.toFixed(2)} do olho`);
});
