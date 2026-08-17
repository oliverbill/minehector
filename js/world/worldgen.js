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

// Três espécies, sorteadas por região e não por árvore: uma faixa de ruído
// lento decide a espécie do lugar. Sortear por árvore daria uma salada de
// espécies a cada dois passos; por região, dá bosque de pinheiro e bosque de
// bétula, que é o que se reconhece de longe.
const CARVALHO = 0;
const BETULA = 1;
const PINHEIRO = 2;
const ESPECIE_FREQ = 1 / 180;

const FLOR_CHANCE = 0.035;   // por coluna de grama livre
const CAPIM_CHANCE = 0.10;

// Lava: poças fundas, longe do céu. Só abaixo desta altura, e raras, para não
// virar armadilha em todo buraco.
const LAVA_TOP = 12;
const LAVA_CHANCE = 0.02;
// Lago de superfície: bem mais raro, porque muda a paisagem inteira onde cai.
const LAGO_LAVA_CHANCE = 0.006;

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

      const especie = especieEm(noise, wx, wz);
      const alto = especie === PINHEIRO;
      const trunkH = (alto ? 6 : 4) + (hash01(seed ^ 0x51ab, wx, wz) < 0.5 ? 0 : 1);
      const topY = h + trunkH;
      if (topY + (alto ? 2 : 1) >= CHUNK_HEIGHT) continue;

      const tronco = especie === BETULA ? Blocks.BIRCH_WOOD : Blocks.WOOD;
      const folha = especie === BETULA ? Blocks.BIRCH_LEAVES
        : especie === PINHEIRO ? Blocks.PINE_LEAVES : Blocks.LEAVES;

      for (let y = h + 1; y <= topY; y++) {
        data[blockIndex(lx, y, lz)] = tronco;
      }

      if (especie === PINHEIRO) {
        // Copa cônica: larga embaixo, um bloco no topo. É a silhueta que
        // distingue um pinheiro de longe, mais do que a cor das agulhas.
        const camadas = [
          { y: topY - 2, r: 2 }, { y: topY - 1, r: 1 },
          { y: topY, r: 1 }, { y: topY + 1, r: 0 }, { y: topY + 2, r: 0 },
        ];
        for (const { y, r } of camadas) {
          if (y + 1 >= CHUNK_HEIGHT) continue;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
              const x = lx + dx;
              const z = lz + dz;
              if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
              const idx = blockIndex(x, y, z);
              if (data[idx] === Blocks.AIR) data[idx] = folha;
            }
          }
        }
        continue;
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
            data[idx] = folha;
          }
        }
      }
    }
  }

  // Flores e capim: uma célula em cima da grama, onde não houver nada.
  // Vêm depois das árvores para nunca nascerem dentro de um tronco.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const h = heights[lx + lz * CHUNK_SIZE];
      if (h + 1 >= CHUNK_HEIGHT) continue;
      if (data[blockIndex(lx, h, lz)] !== Blocks.GRASS) continue;
      if (data[blockIndex(lx, h + 1, lz)] !== Blocks.AIR) continue;

      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      const r = hash01(seed ^ 0x7ee1, wx, wz);
      if (r < FLOR_CHANCE) {
        data[blockIndex(lx, h + 1, lz)] = hash01(seed ^ 0x1f0a, wx, wz) < 0.5
          ? Blocks.FLOWER_RED : Blocks.FLOWER_YELLOW;
      } else if (r < FLOR_CHANCE + CAPIM_CHANCE) {
        data[blockIndex(lx, h + 1, lz)] = Blocks.TALL_GRASS;
      }
    }
  }

  // Lago de lava à flor da terra, raro e só em terreno baixo. As poças fundas
  // abaixo existem, mas ninguém as vê sem cavar dez minutos — e lava que não se
  // vê é o mesmo que lava que não existe. Aqui ela fica no caminho de quem anda.
  for (let lz = 3; lz < CHUNK_SIZE - 3; lz++) {
    for (let lx = 3; lx < CHUNK_SIZE - 3; lx++) {
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      if (hash01(seed ^ 0x1a90, wx, wz) >= LAGO_LAVA_CHANCE) continue;
      const h = heights[lx + lz * CHUNK_SIZE];
      if (h > SEA_TOP + 3) continue;              // só nas partes baixas

      const raio = 2 + Math.floor(hash01(seed ^ 0x77, wx, wz) * 2);
      for (let dz = -raio; dz <= raio; dz++) {
        for (let dx = -raio; dx <= raio; dx++) {
          const x = lx + dx;
          const z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 > raio * raio) continue;
          const hc = heights[x + z * CHUNK_SIZE];
          // Cava uma bacia rasa e enche até a borda: lago afundado no chão, não
          // uma mancha pintada por cima do relevo.
          for (let y = hc; y > hc - 2; y--) data[blockIndex(x, y, z)] = Blocks.LAVA;
          for (let y = hc + 1; y < hc + 4 && y < CHUNK_HEIGHT; y++) {
            data[blockIndex(x, y, z)] = Blocks.AIR;
          }
          if (d2 > (raio - 1) * (raio - 1) && hash01(seed ^ 0xfa1, wx + dx, wz + dz) < 0.35) {
            data[blockIndex(x, hc + 1, z)] = Blocks.FIRE;   // fogo na beirada
          }
        }
      }
    }
  }

  // Poças de lava no fundo do mundo, com uma língua de fogo por cima de parte
  // delas. O fogo fica na célula de ar acima: fogo dentro da lava não se vê.
  for (let lz = 1; lz < CHUNK_SIZE - 1; lz++) {
    for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      if (hash01(seed ^ 0x1a7a, wx, wz) >= LAVA_CHANCE) continue;

      const y = 4 + Math.floor(hash01(seed ^ 0x5ea, wx, wz) * (LAVA_TOP - 4));
      const raio = 1 + Math.floor(hash01(seed ^ 0x9c1, wx, wz) * 2);
      for (let dz = -raio; dz <= raio; dz++) {
        for (let dx = -raio; dx <= raio; dx++) {
          const x = lx + dx;
          const z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          if (dx * dx + dz * dz > raio * raio + 1) continue;
          data[blockIndex(x, y, z)] = Blocks.LAVA;
          data[blockIndex(x, y + 1, z)] = Blocks.AIR;
        }
      }
      if (hash01(seed ^ 0xf0f0, wx, wz) < 0.5) {
        data[blockIndex(lx, y + 1, lz)] = Blocks.FIRE;
      }
    }
  }

  return data;
}

// Espécie da região, por ruído lento. Duas faixas de corte, e o resto é
// carvalho — que continua sendo a árvore comum do mundo.
function especieEm(noise, wx, wz) {
  const n = noise(wx * ESPECIE_FREQ, wz * ESPECIE_FREQ);
  if (n > 0.35) return PINHEIRO;
  if (n < -0.35) return BETULA;
  return CARVALHO;
}
