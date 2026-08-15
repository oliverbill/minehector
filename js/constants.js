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
};

// Nome exibido no hotbar, indexado pelo id do bloco
export const BLOCK_NAMES = ['Ar', 'Grama', 'Terra', 'Pedra', 'Areia', 'Madeira', 'Folhas'];

export const WORLD_SEED = 1337;

export const RENDER_RADIUS = 4;   // raio de visão, em chunks
export const GRAVITY = 24;        // blocos/s²

export const chunkKey = (cx, cz) => `${cx},${cz}`;
