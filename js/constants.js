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
};

// A água é o primeiro bloco que não é parede: atravessa-se nadando, e por isso
// `isSolid` a trata como vazio. Ela ainda é bloco para tudo o mais — ocupa a
// célula, tem textura, é colocada e quebrada, e a mira acerta nela.
export const isWater = (id) => id === Blocks.WATER;
export const isSolidBlock = (id) => id !== Blocks.AIR && id !== Blocks.WATER;

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
export const BLOCK_NAMES = ['Ar', 'Grama', 'Terra', 'Pedra', 'Areia', 'Madeira', 'Folhas', 'Água'];

export const WORLD_SEED = 1337;

export const RENDER_RADIUS = 4;   // raio de visão, em chunks
export const GRAVITY = 24;        // blocos/s²

export const chunkKey = (cx, cz) => `${cx},${cz}`;
