// Atlas de texturas procedural — canvas 2D, células 16×16, pixel art.
// Nenhuma imagem externa: cada textura é desenhada por código.
//
// Regra de ouro deste arquivo: dois blocos diferentes têm de ser distinguíveis
// num relance, de longe e de lado. Por isso cada material tem matiz própria E
// um padrão próprio (pedrisco, estria, rachadura, cacho) — cor sozinha não
// basta, porque terra, madeira e a lateral da grama são todas marrons.

import * as THREE from 'three';
import { Blocks, isPlant } from '../constants.js';

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

// Ruído determinístico em [0, 1) por pixel — sem Math.random.
function hash2(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Pinta um pixel da célula. `shade` desloca os três canais (sombra/luz).
function px(ctx, cellIndex, x, y, [r, g, b], shade) {
  const cellX = (cellIndex % COLS) * CELL;
  const cellY = Math.floor(cellIndex / COLS) * CELL;
  ctx.fillStyle = `rgb(${clamp255(r + shade)},${clamp255(g + shade)},${clamp255(b + shade)})`;
  ctx.fillRect(cellX + x, cellY + y, 1, 1);
}

function drawCell(ctx, cellIndex, pixelFn) {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) pixelFn(x, y);
  }
}

// Paletas bem separadas em matiz: verde-vivo, marrom-neutro, cinza-azulado,
// bege-claro, laranja-queimado, verde-escuro.
const GRASS = [86, 156, 48];
const DIRT = [124, 88, 58];
const STONE = [138, 140, 148];
const SAND = [226, 212, 160];
const WOOD = [154, 101, 42];
const LEAVES = [46, 110, 40];
const WATER = [56, 116, 200];
const LAVA = [214, 92, 24];
const FIRE = [242, 156, 40];
const PETALA_VERM = [206, 58, 52];
const PETALA_AMAR = [230, 196, 60];
const CAULE = [70, 132, 52];
const BETULA = [222, 218, 206];
const FOLHA_BETULA = [122, 168, 74];
const FOLHA_PINHO = [30, 76, 46];

export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  // Grama (topo) — tufos: manchas claras e escuras em blocos de 2px.
  drawCell(ctx, Cells.GRASS_TOP, (x, y) => {
    const tuft = hash2(x >> 1, y >> 1, 11);
    const shade = tuft > 0.78 ? 26 : tuft < 0.22 ? -26 : (hash2(x, y, 12) - 0.5) * 16;
    px(ctx, Cells.GRASS_TOP, x, y, GRASS, shade);
  });

  // Grama (lado) — faixa verde grossa no alto com pontas irregulares descendo
  // pela terra; é o que impede a lateral da grama de virar "terra".
  drawCell(ctx, Cells.GRASS_SIDE, (x, y) => {
    const drip = 6 + Math.floor(hash2(x, 0, 21) * 4); // 6..9 px de verde (>= meio bloco)
    if (y < drip) {
      const shade = (hash2(x, y, 22) - 0.5) * 24;
      px(ctx, Cells.GRASS_SIDE, x, y, GRASS, shade);
    } else {
      const pebble = hash2(x, y, 23) > 0.88 ? -30 : (hash2(x, y, 24) - 0.5) * 14;
      px(ctx, Cells.GRASS_SIDE, x, y, DIRT, pebble);
    }
  });

  // Terra — marrom neutro com pedriscos escuros bem visíveis.
  drawCell(ctx, Cells.DIRT, (x, y) => {
    const p = hash2(x, y, 31);
    const shade = p > 0.84 ? -38 : p < 0.14 ? 24 : (hash2(x, y, 32) - 0.5) * 18;
    px(ctx, Cells.DIRT, x, y, DIRT, shade);
  });

  // Pedra — cinza azulado com rachaduras horizontais escuras (padrão de junta).
  drawCell(ctx, Cells.STONE, (x, y) => {
    const seam = (y === 5 && x > 1 && x < 12) || (y === 11 && (x < 6 || x > 9));
    const fleck = hash2(x >> 1, y >> 1, 41);
    const shade = seam ? -42 : fleck > 0.85 ? 22 : (hash2(x, y, 42) - 0.5) * 12;
    px(ctx, Cells.STONE, x, y, STONE, shade);
  });

  // Areia — bege claro, granulado fino e uniforme (sem manchas grandes).
  drawCell(ctx, Cells.SAND, (x, y) => {
    const grain = hash2(x, y, 51);
    const shade = grain > 0.82 ? -18 : grain < 0.18 ? 14 : 0;
    px(ctx, Cells.SAND, x, y, SAND, shade);
  });

  // Madeira — casca laranja-queimada com estrias verticais de forte contraste
  // e dois nós escuros; nunca confundível com terra.
  drawCell(ctx, Cells.WOOD, (x, y) => {
    const stripe = hash2(x, 0, 61);
    let shade = stripe > 0.72 ? -40 : stripe < 0.2 ? 20 : (hash2(x, y, 62) - 0.5) * 12;
    const knot = (x - 4) * (x - 4) + (y - 5) * (y - 5) < 4 ||
                 (x - 11) * (x - 11) + (y - 12) * (y - 12) < 3;
    if (knot) shade = -52;
    px(ctx, Cells.WOOD, x, y, WOOD, shade);
  });

  // Folhas — verde escuro em cachos, com vãos quase pretos entre eles.
  drawCell(ctx, Cells.LEAVES, (x, y) => {
    const clump = hash2(x >> 1, y >> 1, 71);
    const gap = hash2(x, y, 72);
    const shade = gap > 0.9 ? -46 : clump > 0.7 ? 30 : clump < 0.3 ? -22 : 0;
    px(ctx, Cells.LEAVES, x, y, LEAVES, shade);
  });

  // Água — azul com ondulação em faixas horizontais e brilhos esparsos. O
  // padrão é horizontal de propósito: a face que mais se olha é a de cima, e
  // faixa deitada lê como superfície de água; ruído solto leria como pedra azul.
  drawCell(ctx, Cells.WATER, (x, y) => {
    const onda = Math.sin((x + y * 0.6) * 0.9) * 0.5 + 0.5;
    const brilho = hash2(x, y, 81) > 0.94;
    const shade = brilho ? 46 : -14 + onda * 26;
    px(ctx, Cells.WATER, x, y, WATER, shade);
  });

  // Lava — laranja com veios claros e crosta escura, mais contrastada que a
  // água para se ler como quente mesmo de longe.
  drawCell(ctx, Cells.LAVA, (x, y) => {
    const veio = Math.sin((x * 0.7 + y * 1.3)) * 0.5 + 0.5;
    const crosta = hash2(x >> 1, y >> 1, 91) > 0.86;
    const shade = crosta ? -60 : -10 + veio * 52;
    px(ctx, Cells.LAVA, x, y, LAVA, shade);
  });

  // As células abaixo são desenhadas em placa cruzada e ficam com o RESTO
  // TRANSPARENTE — por isso nada de preencher a célula inteira antes. O material
  // das plantas usa alphaTest, então o pixel que não for pintado aqui some.
  const pintarPlanta = (cell, pixelFn) => {
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) pixelFn(x, y);
  };

  // Fogo: línguas subindo, mais largas embaixo e rarefeitas no alto.
  pintarPlanta(Cells.FIRE, (x, y) => {
    const altura = 1 - y / CELL;                       // 0 no topo, 1 na base
    const lingua = Math.abs(Math.sin(x * 0.8 + altura * 3)) * 0.6 + altura * 0.55;
    if (hash2(x, y, 101) > lingua) return;             // resto fica vazado
    const quente = altura > 0.55 && hash2(x, y, 102) > 0.4;
    px(ctx, Cells.FIRE, x, y, quente ? [250, 226, 120] : FIRE, (hash2(x, y, 103) - 0.5) * 30);
  });

  // Flores: caule fino ao centro, folhinhas e a corola em cima.
  const flor = (cell, cor) => pintarPlanta(cell, (x, y) => {
    const centro = Math.abs(x - 7.5);
    if (y > 7 && centro < 1) { px(ctx, cell, x, y, CAULE, (hash2(x, y, 111) - 0.5) * 20); return; }
    if (y > 9 && y < 12 && centro >= 1 && centro < 3.5 && (x + y) % 3 === 0) {
      px(ctx, cell, x, y, CAULE, -14); return;   // folhas
    }
    const dx = x - 7.5;
    const dy = y - 4.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 3.6) {
      const miolo = r < 1.2;
      px(ctx, cell, x, y, miolo ? [242, 214, 96] : cor, miolo ? 0 : (hash2(x, y, 112) - 0.5) * 34);
    }
  });
  flor(Cells.FLOWER_RED, PETALA_VERM);
  flor(Cells.FLOWER_YELLOW, PETALA_AMAR);

  // Capim alto: tufo de talos de alturas diferentes.
  pintarPlanta(Cells.TALL_GRASS, (x, y) => {
    const talo = 4 + Math.floor(hash2(x, 0, 121) * 9);   // até onde este talo sobe
    if (y < CELL - talo) return;
    px(ctx, Cells.TALL_GRASS, x, y, GRASS, -18 + hash2(x, y, 122) * 34);
  });

  // Bétula: tronco claro com as marcas escuras características.
  drawCell(ctx, Cells.BIRCH_WOOD, (x, y) => {
    const marca = hash2(x >> 2, y >> 1, 131) > 0.82 && x % 4 < 3;
    const shade = marca ? -70 : (hash2(x, y, 132) - 0.5) * 16;
    px(ctx, Cells.BIRCH_WOOD, x, y, BETULA, shade);
  });

  drawCell(ctx, Cells.BIRCH_LEAVES, (x, y) => {
    const clump = hash2(x >> 1, y >> 1, 141);
    const gap = hash2(x, y, 142);
    const shade = gap > 0.9 ? -40 : clump > 0.7 ? 26 : clump < 0.3 ? -18 : 0;
    px(ctx, Cells.BIRCH_LEAVES, x, y, FOLHA_BETULA, shade);
  });

  // Pinheiro: agulhas escuras, com riscos verticais em vez de cachos.
  drawCell(ctx, Cells.PINE_LEAVES, (x, y) => {
    const agulha = (x + Math.floor(y / 2)) % 3 === 0;
    const gap = hash2(x, y, 151) > 0.88;
    const shade = gap ? -34 : agulha ? 24 : (hash2(x, y, 152) - 0.5) * 14;
    px(ctx, Cells.PINE_LEAVES, x, y, FOLHA_PINHO, shade);
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
      case Blocks.WATER: return Cells.WATER;
      case Blocks.LAVA: return Cells.LAVA;
      case Blocks.FIRE: return Cells.FIRE;
      case Blocks.FLOWER_RED: return Cells.FLOWER_RED;
      case Blocks.FLOWER_YELLOW: return Cells.FLOWER_YELLOW;
      case Blocks.TALL_GRASS: return Cells.TALL_GRASS;
      case Blocks.BIRCH_WOOD: return Cells.BIRCH_WOOD;
      case Blocks.BIRCH_LEAVES: return Cells.BIRCH_LEAVES;
      case Blocks.PINE_LEAVES: return Cells.PINE_LEAVES;
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

  // Miniatura da face mais reconhecível do bloco (topo para grama, lado para o
  // resto), como data URL — o hotbar usa isto para mostrar a textura de verdade.
  function swatch(blockId) {
    const cell = cellFor(blockId, blockId === Blocks.GRASS ? 0 : 2);
    const out = document.createElement('canvas');
    out.width = CELL;
    out.height = CELL;
    const octx = out.getContext('2d');
    // Planta tem a célula vazada: sem um fundo, o ícone do hotbar sai invisível.
    if (isPlant(blockId)) {
      octx.fillStyle = 'rgba(28,34,28,0.85)';
      octx.fillRect(0, 0, CELL, CELL);
    }
    octx.drawImage(
      canvas,
      (cell % COLS) * CELL, Math.floor(cell / COLS) * CELL, CELL, CELL,
      0, 0, CELL, CELL,
    );
    return out.toDataURL();
  }

  return { texture, uvRect, swatch };
}
