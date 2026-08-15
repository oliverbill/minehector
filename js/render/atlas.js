// Atlas de texturas procedural — canvas 2D, células 16×16, pixel art.
// Nenhuma imagem externa: cada textura é desenhada por código com ruído
// determinístico de tom para não ficar chapada.

import * as THREE from 'three';
import { Blocks } from '../constants.js';

const CELL = 16;      // pixels por célula
const COLS = 8;       // células por linha
const ROWS = 2;       // linhas de células

// Índices das células no atlas (col + row * COLS)
const Cells = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
};

// Ruído determinístico em [0, 1) por pixel/célula — sem Math.random.
function hash2(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// Pinta um pixel com variação sutil de tom em torno da cor base.
function px(ctx, cellX, cellY, x, y, [r, g, b], jitter, salt) {
  const n = (hash2(cellX * CELL + x, cellY * CELL + y, salt) - 0.5) * 2 * jitter;
  ctx.fillStyle = `rgb(${clamp255(r + n)},${clamp255(g + n)},${clamp255(b + n)})`;
  ctx.fillRect(cellX * CELL + x, cellY * CELL + y, 1, 1);
}

function drawCell(ctx, cellIndex, pixelFn) {
  const cellX = cellIndex % COLS;
  const cellY = Math.floor(cellIndex / COLS);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      pixelFn(ctx, cellX, cellY, x, y);
    }
  }
}

export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  // Grama topo — verde com variação de tom
  drawCell(ctx, Cells.GRASS_TOP, (c, cx, cy, x, y) => {
    px(c, cx, cy, x, y, [95, 159, 53], 14, 11);
  });

  // Grama lado — terra com franja verde irregular no alto
  drawCell(ctx, Cells.GRASS_SIDE, (c, cx, cy, x, y) => {
    const fringe = 2 + Math.floor(hash2(x, 0, 77) * 3); // 2..4 px de franja
    if (y < fringe) px(c, cx, cy, x, y, [95, 159, 53], 14, 12);
    else px(c, cx, cy, x, y, [134, 96, 67], 12, 13);
  });

  // Terra — marrom
  drawCell(ctx, Cells.DIRT, (c, cx, cy, x, y) => {
    px(c, cx, cy, x, y, [134, 96, 67], 14, 21);
  });

  // Pedra — cinza com manchas
  drawCell(ctx, Cells.STONE, (c, cx, cy, x, y) => {
    const blotch = hash2(x >> 1, y >> 1, 31) > 0.8 ? -18 : 0;
    px(c, cx, cy, x, y, [125 + blotch, 125 + blotch, 125 + blotch], 10, 32);
  });

  // Areia — bege claro
  drawCell(ctx, Cells.SAND, (c, cx, cy, x, y) => {
    px(c, cx, cy, x, y, [219, 207, 163], 10, 41);
  });

  // Madeira (casca) — estrias verticais
  drawCell(ctx, Cells.WOOD, (c, cx, cy, x, y) => {
    const stripe = hash2(x, 0, 51) > 0.6 ? -22 : 0;
    px(c, cx, cy, x, y, [103 + stripe, 82 + stripe, 49 + stripe], 8, 52);
  });

  // Folhas — verde escuro com "furos" mais escuros
  drawCell(ctx, Cells.LEAVES, (c, cx, cy, x, y) => {
    const hole = hash2(x, y, 61) > 0.85 ? -30 : 0;
    px(c, cx, cy, x, y, [58 + hole, 121 + hole, 44 + hole], 16, 62);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // Célula do atlas por (blockId, face). face: 0=topo, 1=fundo, 2=lado.
  const cellFor = (blockId, face) => {
    switch (blockId) {
      case Blocks.GRASS:
        if (face === 0) return Cells.GRASS_TOP;
        if (face === 1) return Cells.DIRT;
        return Cells.GRASS_SIDE;
      case Blocks.DIRT: return Cells.DIRT;
      case Blocks.STONE: return Cells.STONE;
      case Blocks.SAND: return Cells.SAND;
      case Blocks.WOOD: return Cells.WOOD;
      case Blocks.LEAVES: return Cells.LEAVES;
      default: return Cells.DIRT;
    }
  };

  const W = canvas.width;
  const H = canvas.height;

  // Meio-pixel de inset nas bordas da célula para evitar bleeding entre células.
  // Nota: CanvasTexture tem flipY=true, então v cresce para o TOPO da imagem —
  // v1 corresponde ao alto da textura (onde está a franja da grama-lado).
  function uvRect(blockId, face) {
    const cell = cellFor(blockId, face);
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    return {
      u0: (col * CELL + 0.5) / W,
      v0: 1 - (row * CELL + CELL - 0.5) / H,
      u1: (col * CELL + CELL - 0.5) / W,
      v1: 1 - (row * CELL + 0.5) / H,
    };
  }

  return { texture, uvRect };
}
