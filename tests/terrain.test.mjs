// Blocos novos do cenário: lava, fogo, flores, capim e as outras árvores.
//
// O que se afirma aqui é o contrato de cada um — o que barra passagem, o que a
// mira acerta, em que malha cada um é desenhado — e que a geração de fato os
// põe no mundo. Cor e beleza ficam para o olho; isto aqui é o que quebra calado.

import { test, assert, assertEqual } from './tiny-test.mjs';
import {
  Blocks, isPlant, isLiquid, isSolidBlock, BLOCK_NAMES,
} from '../js/constants.js';
import { generateChunk } from '../js/world/worldgen.js';
import { buildChunkMesh } from '../js/render/mesher.js';
import { moveEntity, inLiquid } from '../js/player/physics.js';
import { flatWorld } from './harness.mjs';

const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

test('cada bloco tem nome (o hotbar e os recados leem daqui)', () => {
  for (const [nome, id] of Object.entries(Blocks)) {
    assert(BLOCK_NAMES[id], `bloco ${nome} (id ${id}) sem nome`);
  }
});

test('planta e líquido não barram passagem; o resto barra', () => {
  for (const id of [Blocks.FLOWER_RED, Blocks.FLOWER_YELLOW, Blocks.TALL_GRASS, Blocks.FIRE]) {
    assert(isPlant(id), `${BLOCK_NAMES[id]} devia ser planta`);
    assertEqual(isSolidBlock(id), false, `${BLOCK_NAMES[id]} virou parede`);
  }
  for (const id of [Blocks.WATER, Blocks.LAVA]) {
    assert(isLiquid(id), `${BLOCK_NAMES[id]} devia ser líquido`);
    assertEqual(isSolidBlock(id), false, `${BLOCK_NAMES[id]} virou parede`);
  }
  for (const id of [Blocks.STONE, Blocks.BIRCH_WOOD, Blocks.BIRCH_LEAVES, Blocks.PINE_LEAVES]) {
    assert(isSolidBlock(id), `${BLOCK_NAMES[id]} devia ser sólido`);
  }
});

test('atravessa-se uma flor andando, e ela não some do mundo', () => {
  const { world, floor } = flatWorld(40, 32);
  world.setBlock(5, floor, 5, Blocks.FLOWER_RED);

  assertEqual(world.isSolid(5, floor, 5), false, 'a flor barrou o caminho');
  assertEqual(world.isTargetable(5, floor, 5), true, 'a mira não enxerga a flor');
  assertEqual(world.getBlock(5, floor, 5), Blocks.FLOWER_RED, 'a flor sumiu');
  // E o chão continua sendo o chão: flor não vira superfície onde se constrói.
  assertEqual(world.surfaceHeight(5, 5), floor - 1, 'a flor virou superfície');
});

test('a lava afunda o corpo como a água (o que muda é a cara, não o empuxo)', () => {
  const { world, floor } = flatWorld(40, 32);
  for (let y = floor; y < floor + 12; y++) world.setBlock(5, y, 5, Blocks.LAVA);

  const alto = floor + 8;
  const naLava = {
    pos: { x: 5.5, y: alto, z: 5.5 }, vel: { x: 0, y: 0, z: 0 },
    width: 0.6, height: 1.8, onGround: false,
  };
  const noAr = {
    pos: { x: 20.5, y: alto, z: 20.5 }, vel: { x: 0, y: 0, z: 0 },
    width: 0.6, height: 1.8, onGround: false,
  };
  assert(inLiquid(world, naLava), 'o corpo não está na lava');

  // A régua é a queda no ar, não um número escolhido a dedo: o que se promete é
  // que a lava segura o corpo, e é isso que a comparação mede.
  for (let i = 0; i < 24; i++) { moveEntity(world, naLava, 1 / 60); moveEntity(world, noAr, 1 / 60); }
  const quedaLava = alto - naLava.pos.y;
  const quedaAr = alto - noAr.pos.y;
  assert(quedaLava < quedaAr / 2,
    `caiu ${quedaLava.toFixed(2)} na lava contra ${quedaAr.toFixed(2)} no ar`);
});

test('planta vai para a malha própria, em cruz — não é cubo', () => {
  const { world, floor } = flatWorld(40, 32);
  const get = (x, y, z) => world.getBlock(x, y, z);

  const antes = buildChunkMesh(get, 0, 0, uv);
  assertEqual(antes.plants.indices.length, 0, 'apareceu planta num chunk sem planta');

  world.setBlock(5, floor, 5, Blocks.FLOWER_RED);
  const depois = buildChunkMesh(get, 0, 0, uv);
  // Duas placas por planta: 8 vértices, 12 índices. Um cubo daria 6 faces.
  assertEqual(depois.plants.indices.length, 12, 'a flor não saiu como duas placas cruzadas');
  assertEqual(depois.plants.positions.length / 3, 8, 'vértices da cruz');
  assertEqual(depois.water.indices.length, 0, 'flor foi parar na malha da água');
});

test('bloco ao lado de planta continua mostrando a face (planta não tapa)', () => {
  const { world, floor } = flatWorld(40, 32);
  const get = (x, y, z) => world.getBlock(x, y, z);

  // Uma coluna com uma planta encostada: a face lateral do bloco tem de existir,
  // senão o terreno fica com buracos onde houver capim.
  world.setBlock(6, floor, 6, Blocks.STONE);
  const semPlanta = buildChunkMesh(get, 0, 0, uv).opaque.indices.length;
  world.setBlock(7, floor, 6, Blocks.TALL_GRASS);
  const comPlanta = buildChunkMesh(get, 0, 0, uv).opaque.indices.length;

  assertEqual(comPlanta, semPlanta, 'a planta escondeu (ou criou) face de bloco vizinho');
});

test('a geração põe no mundo tudo que foi prometido', () => {
  const conta = new Map();
  for (let cx = -3; cx <= 3; cx++) {
    for (let cz = -3; cz <= 3; cz++) {
      for (const b of generateChunk(1337, cx, cz)) {
        if (b) conta.set(b, (conta.get(b) || 0) + 1);
      }
    }
  }
  const esperados = [
    Blocks.FLOWER_RED, Blocks.FLOWER_YELLOW, Blocks.TALL_GRASS,
    Blocks.BIRCH_WOOD, Blocks.BIRCH_LEAVES, Blocks.PINE_LEAVES,
    Blocks.LAVA, Blocks.FIRE,
  ];
  for (const id of esperados) {
    assert((conta.get(id) || 0) > 0, `${BLOCK_NAMES[id]} não apareceu em 49 chunks`);
  }
  // E o mundo continua sendo mais chão que enfeite.
  assert(conta.get(Blocks.STONE) > conta.get(Blocks.TALL_GRASS) * 10, 'virou um jardim');
});

test('há lava onde se anda, não só no fundo do mundo', () => {
  let rasa = 0;
  for (let cx = -8; cx <= 8; cx++) {
    for (let cz = -8; cz <= 8; cz++) {
      const d = generateChunk(1337, cx, cz);
      for (let y = 20; y < 45; y++) {
        for (let i = 0; i < 256; i++) if (d[i + y * 256] === Blocks.LAVA) rasa++;
      }
    }
  }
  // Lava que só existe a dez minutos de escavação é o mesmo que lava nenhuma.
  assert(rasa > 50, `só ${rasa} células de lava acima de y=20 em 289 chunks`);
});

test('as árvores novas nascem inteiras: tronco e copa próprios', () => {
  let betulas = 0;
  let pinheiros = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const d = generateChunk(1337, cx, cz);
      for (let i = 0; i < d.length; i++) {
        if (d[i] === Blocks.BIRCH_WOOD) betulas++;
        if (d[i] === Blocks.PINE_LEAVES) pinheiros++;
      }
    }
  }
  assert(betulas > 0 && pinheiros > 0, `bétula ${betulas}, pinheiro ${pinheiros}`);
});
