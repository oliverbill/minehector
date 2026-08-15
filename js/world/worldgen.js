// Geração determinística de chunks: heightmap por octaves de Perlin,
// camadas STONE/DIRT/GRASS, praias de SAND e árvores por hash de posição.
// Sem Math.random — tudo função da seed. Roda em navegador e em Node puro.

import { CHUNK_SIZE, CHUNK_HEIGHT, blockIndex, Blocks } from '../constants.js';
import { makeNoise2D } from './noise.js';

// Terreno entre ~18 e ~40 de altura.
const HEIGHT_BASE = 29;
const HEIGHT_AMP = 11;
const SEA_TOP = 22;      // abaixo disso o topo vira SAND (praias)
const OCTAVES = 4;
const BASE_FREQ = 1 / 64;

const TREE_CHANCE = 0.02; // probabilidade determinística por coluna elegível

// Cache do gerador de ruído por seed (evita reembaralhar a permutação por chunk).
let cachedSeed = null;
let cachedNoise = null;
function noiseFor(seed) {
  if (cachedSeed !== seed) {
    cachedSeed = seed;
    cachedNoise = makeNoise2D(seed);
  }
  return cachedNoise;
}

// Hash inteiro determinístico de (seed, x, z) -> [0, 1).
function hash01(seed, x, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function terrainHeight(noise, wx, wz) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = BASE_FREQ;
  for (let o = 0; o < OCTAVES; o++) {
    sum += noise(wx * freq, wz * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  const n = sum / norm; // [-1, 1]
  let h = Math.round(HEIGHT_BASE + n * HEIGHT_AMP);
  if (h < 1) h = 1;
  if (h > CHUNK_HEIGHT - 10) h = CHUNK_HEIGHT - 10;
  return h;
}

/**
 * generateChunk(seed, cx, cz) -> Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT)
 */
export function generateChunk(seed, cx, cz) {
  const noise = noiseFor(seed);
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

  // Terreno em camadas.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      const h = terrainHeight(noise, wx, wz);
      heights[lx + lz * CHUNK_SIZE] = h;

      const beach = h <= SEA_TOP;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y <= h - 4) id = Blocks.STONE;
        else if (y <= h - 1) id = beach ? Blocks.SAND : Blocks.DIRT;
        else id = beach ? Blocks.SAND : Blocks.GRASS;
        data[blockIndex(lx, y, lz)] = id;
      }
    }
  }

  // Árvores: determinísticas por posição de mundo, base local em 2..13
  // para a copa 3×3 nunca cruzar a borda do chunk.
  for (let lz = 2; lz <= 13; lz++) {
    for (let lx = 2; lx <= 13; lx++) {
      const h = heights[lx + lz * CHUNK_SIZE];
      if (data[blockIndex(lx, h, lz)] !== Blocks.GRASS) continue; // só em grama

      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      if (hash01(seed, wx, wz) >= TREE_CHANCE) continue;

      const trunkH = 4 + (hash01(seed ^ 0x51ab, wx, wz) < 0.5 ? 0 : 1); // 4 ou 5
      const topY = h + trunkH;
      if (topY + 1 >= CHUNK_HEIGHT) continue;

      // Tronco.
      for (let y = h + 1; y <= topY; y++) {
        data[blockIndex(lx, y, lz)] = Blocks.WOOD;
      }

      // Copa 3×3×2 centrada no tronco, nas duas camadas do topo.
      // Cantos podem ficar vazados (por hash) para uma silhueta natural.
      for (let dy = 0; dy <= 1; dy++) {
        const y = topY + dy;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = lx + dx;
            const z = lz + dz;
            const idx = blockIndex(x, y, z);
            if (data[idx] !== Blocks.AIR) continue; // não sobrescreve o tronco
            const isCorner = dx !== 0 && dz !== 0;
            if (isCorner && hash01(seed ^ (0xc0fa + dy), wx + dx, wz + dz) < 0.4) {
              continue; // canto vazado
            }
            data[idx] = Blocks.LEAVES;
          }
        }
      }
    }
  }

  return data;
}
