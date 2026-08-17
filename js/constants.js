// Constantes compartilhadas por todos os módulos.
// Este arquivo é o contrato base — nenhum módulo redefine estes valores.

export const CHUNK_SIZE = 16;    // dimensão X e Z de um chunk
export const CHUNK_HEIGHT = 64;  // dimensão Y

// Índice de um bloco dentro do Uint8Array do chunk (coordenadas locais 0..15 / 0..63)
export const blockIndex = (x, y, z) =>
  x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

export const Blocks = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  LAVA: 8,
  FIRE: 9,
  FLOWER_RED: 10,
  FLOWER_YELLOW: 11,
  TALL_GRASS: 12,
  BIRCH_WOOD: 13,
  BIRCH_LEAVES: 14,
  PINE_LEAVES: 15,
};

// A água é o primeiro bloco que não é parede: atravessa-se nadando, e por isso
// `isSolid` a trata como vazio. Ela ainda é bloco para tudo o mais — ocupa a
// célula, tem textura, é colocada e quebrada, e a mira acerta nela.
export const isWater = (id) => id === Blocks.WATER;

// Líquidos: atravessam-se, e dentro deles o corpo flutua e afunda devagar.
export const isLiquid = (id) => id === Blocks.WATER || id === Blocks.LAVA;

// Plantas e fogo: desenhados como duas placas cruzadas, não como cubo. Uma flor
// que ocupa um cubo inteiro não é uma flor, é um bloco colorido — e ninguém
// esbarra numa flor, por isso também não barram passagem.
export const isPlant = (id) => id === Blocks.FLOWER_RED || id === Blocks.FLOWER_YELLOW
  || id === Blocks.TALL_GRASS || id === Blocks.FIRE;

// Barra passagem? Tudo que não é ar, líquido ou planta.
export const isSolidBlock = (id) => id !== Blocks.AIR && !isLiquid(id) && !isPlant(id);

// Onde uma planta consegue nascer e ficar.
export const isSoil = (id) => id === Blocks.GRASS || id === Blocks.DIRT || id === Blocks.SAND;

// De quem é cada célula editada. Quem escreve numa célula passa a ser dono dela,
// e só o dono escreve de novo ali: é o que impede o jogador de derrubar a casa
// que um bot levantou, e o bot de assentar por cima do que o jogador fez.
//
// AIR conta como escrita. O vão de porta e o miolo limpo de uma casa são células
// de ar assentadas pela obra — sem posse sobre elas, tapar a porta de uma casa
// alheia com um bloco continuaria valendo, e é alterar a construção do mesmo jeito.
export const Owner = {
  NONE: 0,    // terreno como nasceu — livre para os dois
  PLAYER: 1,
  BOT: 2,
};

// Nome exibido no hotbar, indexado pelo id do bloco
export const BLOCK_NAMES = [
  'Ar', 'Grama', 'Terra', 'Pedra', 'Areia', 'Madeira', 'Folhas', 'Água',
  'Lava', 'Fogo', 'Flor vermelha', 'Flor amarela', 'Capim', 'Bétula',
  'Folhas de bétula', 'Pinheiro',
];

export const WORLD_SEED = 1337;

export const RENDER_RADIUS = 4;   // raio de visão, em chunks
export const GRAVITY = 24;        // blocos/s²

export const chunkKey = (cx, cz) => `${cx},${cz}`;
