// Plantas das construções que os bots levantam. Módulo PURO: sem THREE, sem DOM,
// sem world — só descreve blocos em coordenadas locais, para ser testável.
//
// Coordenadas locais: x em [0,w), z em [0,d), y = 0 é o piso (primeiro bloco
// ACIMA do terreno). O construtor traduz para coordenadas de mundo.
//
// Regra que manda em todas: a construção tem de ser habitável. Vão de porta com
// 2 blocos de altura, teto interno com pelo menos 2, e degrau nunca maior que 1
// — o jogador tem 1,8 de altura e sobe 1 bloco pulando, e o bot só pula quando
// há bloco à frente com 2 livres acima (bot.js). Escada de 2 em 2 tranca os dois
// do lado de fora, e uma construção em que não se entra é cenário, não casa.

import { Blocks } from '../constants.js';

const key = (x, y, z) => `${x},${y},${z}`;

// Acumulador de blocos. `air` é aplicado antes dos sólidos: primeiro se limpa o
// volume (uma árvore no meio do terreno arruinaria o interior), depois se monta.
function sketch() {
  const air = new Map();
  const solid = new Map();

  const put = (x, y, z, id) => {
    const k = key(x, y, z);
    if (id === Blocks.AIR) { solid.delete(k); air.set(k, [x, y, z, id]); }
    else { air.delete(k); solid.set(k, [x, y, z, id]); }
  };

  const fill = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) put(x, y, z, id);
      }
    }
  };

  // Paredes do perímetro (sem tampar o miolo).
  const walls = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (x === x0 || x === x1 || z === z0 || z === z1) put(x, y, z, id);
        }
      }
    }
  };

  return {
    put, fill, walls,
    // AIR primeiro, sólidos de baixo para cima: o bot constrói na ordem em que
    // um pedreiro constrói, e nada fica pendurado esperando apoio.
    blocks: () => [
      ...air.values(),
      ...[...solid.values()].sort((a, b) => a[1] - b[1]),
    ],
  };
}

// Telhado de duas águas sobre um retângulo, subindo em degraus de 1.
function gableRoof(s, x0, z0, x1, z1, y, id, eave = 1) {
  const steps = Math.ceil(Math.min(x1 - x0, z1 - z0) / 2) + 1;
  for (let i = 0; i < steps; i++) {
    const a = x0 - eave + i;
    const b = x1 + eave - i;
    const c = z0 - eave + i;
    const d = z1 + eave - i;
    if (a > b || c > d) break;
    for (let z = c; z <= d; z++) {
      for (let x = a; x <= b; x++) {
        if (x === a || x === b || z === c || z === d) s.put(x, y + i, z, id);
      }
    }
    if (i === steps - 1) s.fill(a, y + i, c, b, y + i, d, id); // fecha a cumeeira
  }
}

// Janela: buraco de 1×1 na parede, na altura dos olhos de quem está dentro.
function window1(s, x, y, z) {
  s.put(x, y, z, Blocks.AIR);
}

// Vão de porta 1 de largura por 2 de altura, virado para -Z (frente da planta).
function doorway(s, x, z) {
  s.put(x, 1, z, Blocks.AIR);
  s.put(x, 2, z, Blocks.AIR);
}

// Escada de degraus de 1 bloco, de `yLow` a `yHigh`: o degrau i fica em
// (x+dx*i, z+dz*i) com o topo em yLow+i, maciço desde `baseY` para não flutuar,
// e com 2 blocos livres acima. Os dois livres não são enfeite: sem eles o
// jogador bate a cabeça no meio da subida e o bot desiste de pular.
function staircase(s, x, z, dx, dz, yLow, yHigh, id, baseY = -1) {
  for (let i = 0; yLow + i <= yHigh; i++) {
    const sx = x + dx * i;
    const sz = z + dz * i;
    const top = yLow + i;
    s.fill(sx, baseY, sz, sx, top, sz, id);
    s.fill(sx, top + 1, sz, sx, top + 2, sz, Blocks.AIR);
  }
}

// ---------------------------------------------------------------------------
// As construções
// ---------------------------------------------------------------------------

// Cabana com varanda: a casa de quem acabou de chegar. Um cômodo, porta na
// frente, janelas nos quatro lados e uma varanda coberta com esteios.
function cabana(rnd) {
  const s = sketch();
  const w = 7, d = 6;
  const wall = rnd() < 0.5 ? Blocks.WOOD : Blocks.STONE;
  const inner = w - 2;

  s.fill(0, -1, 0, w - 1, -1, d - 1, Blocks.STONE);        // alicerce
  s.fill(0, 0, 0, w - 1, 0, d - 1, Blocks.WOOD);           // piso
  s.fill(1, 1, 1, w - 2, 3, d - 2, Blocks.AIR);            // cômodo
  s.walls(0, 1, 0, w - 1, 3, d - 1, wall);
  s.fill(0, 4, 0, w - 1, 4, d - 1, Blocks.WOOD);           // forro
  gableRoof(s, 0, 0, w - 1, d - 1, 5, Blocks.LEAVES);

  const doorX = Math.floor(w / 2);
  doorway(s, doorX, 0);
  window1(s, 1, 2, 0); window1(s, w - 2, 2, 0);
  window1(s, 1, 2, d - 1); window1(s, w - 2, 2, d - 1);
  window1(s, 0, 2, 2); window1(s, w - 1, 2, 2);

  // Varanda: piso à frente, esteios nos cantos e cobertura.
  s.fill(0, 0, -2, w - 1, 0, -1, Blocks.WOOD);
  s.fill(0, 1, -2, w - 1, 3, -1, Blocks.AIR);
  s.fill(0, 1, -2, 0, 3, -2, Blocks.WOOD);
  s.fill(w - 1, 1, -2, w - 1, 3, -2, Blocks.WOOD);
  s.fill(0, 4, -2, w - 1, 4, -1, Blocks.WOOD);
  // Degrau da varanda para o chão, para não haver salto na entrada.
  s.fill(doorX, 0, -3, doorX, 0, -3, Blocks.WOOD);
  s.fill(doorX, 1, -3, doorX, 2, -3, Blocks.AIR);

  return { kind: 'cabana', w, d, door: { x: doorX, z: -3 }, blocks: s.blocks() };
}

// Palafita: casa sobre estacas, com escada externa. Sai do chão, então serve
// para terreno que a cabana não aproveitaria.
function palafita(rnd) {
  const s = sketch();
  const w = 7, d = 7;
  const deck = 3;                                          // altura do estrado
  const wall = Blocks.WOOD;

  for (const [px, pz] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1], [0, 3], [w - 1, 3]]) {
    s.fill(px, -1, pz, px, deck - 1, pz, Blocks.WOOD);      // estacas
  }
  s.fill(0, deck, 0, w - 1, deck, d - 1, Blocks.WOOD);      // estrado
  s.fill(1, deck + 1, 1, w - 2, deck + 3, d - 2, Blocks.AIR);
  s.walls(0, deck + 1, 0, w - 1, deck + 3, d - 1, wall);
  s.fill(0, deck + 4, 0, w - 1, deck + 4, d - 1, Blocks.WOOD);
  gableRoof(s, 0, 0, w - 1, d - 1, deck + 5, rnd() < 0.5 ? Blocks.STONE : Blocks.LEAVES);

  const doorX = Math.floor(w / 2);
  s.put(doorX, deck + 1, 0, Blocks.AIR);
  s.put(doorX, deck + 2, 0, Blocks.AIR);
  window1(s, 1, deck + 2, d - 1); window1(s, w - 2, deck + 2, d - 1);
  window1(s, 0, deck + 2, 3); window1(s, w - 1, deck + 2, 3);

  // Escada externa até o estrado: o degrau mais baixo é o mais distante da casa,
  // senão a escada sobe ao contrário e ninguém alcança a porta.
  staircase(s, doorX, -deck, 0, 1, 0, deck - 1, Blocks.WOOD);

  return { kind: 'palafita', w, d, door: { x: doorX, z: -deck }, blocks: s.blocks() };
}

// Torre de vigia: três lances, escada por dentro e sacada no topo. Referência
// clássica de aldeia — serve de ponto de encontro e de mirante.
function torre() {
  const s = sketch();
  const w = 5, d = 5;
  const top = 10;

  s.fill(0, -1, 0, w - 1, -1, d - 1, Blocks.STONE);
  s.fill(0, 0, 0, w - 1, 0, d - 1, Blocks.STONE);
  s.walls(0, 1, 0, w - 1, top, d - 1, Blocks.STONE);
  s.fill(1, 1, 1, w - 2, top, d - 2, Blocks.AIR);

  doorway(s, 2, 0);

  // Escada em caracol pelas paredes: degraus de 1, sempre com 2 livres acima e
  // sempre em célula vizinha da anterior. A ordem começa longe da porta de
  // propósito: a célula (2,1) é a de trás da entrada, e um degrau ali na
  // primeira volta tapa o vão — no anel abaixo ela só aparece no alto, onde não
  // atrapalha. O laço vai até top-1 para o último degrau chegar à altura do
  // alçapão; parando antes, sobra um salto de 2 e a sacada fica inalcançável.
  const ring = [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1]];
  const tail = [];
  for (let i = 0; i <= top - 1; i++) {
    const [sx, sz] = ring[i % ring.length];
    s.put(sx, i, sz, Blocks.WOOD);
    s.fill(sx, i + 1, sz, sx, i + 2, sz, Blocks.AIR);
    tail.push([sx, sz]);
  }

  // Sacada: piso saliente e parapeito de 1, com vãos para olhar.
  //
  // O alçapão cobre os ÚLTIMOS degraus, não uma célula só. Com um furo apenas,
  // o trecho final da escada fica espremido debaixo do piso: sem duas células
  // livres não há como pular o degrau, e a sacada vira enfeite inalcançável.
  s.fill(-1, top, -1, w, top, d, Blocks.WOOD);
  for (const [hx, hz] of tail.slice(-3)) {
    s.fill(hx, top, hz, hx, top + 2, hz, Blocks.AIR);
  }
  s.walls(-1, top + 1, -1, w, top + 1, d, Blocks.WOOD);
  for (let i = 0; i < 4; i++) {
    window1(s, 0, top + 1, -1 + i);
    window1(s, w - 1, top + 1, -1 + i);
  }
  for (let y = 3; y <= top - 2; y += 3) {                  // seteiras
    window1(s, 0, y, 2); window1(s, w - 1, y, 2); window1(s, 2, y, d - 1);
  }

  return { kind: 'torre', w, d, door: { x: 2, z: -1 }, blocks: s.blocks() };
}

// Poço: o marco da aldeia. Boca de pedra, balde imaginário, cobertura em quatro
// esteios. Sem água no jogo, o fundo é areia — o buraco continua sendo buraco.
function poco() {
  const s = sketch();
  const w = 5, d = 5;

  s.fill(1, -1, 1, 3, -1, 3, Blocks.STONE);
  s.fill(1, 0, 1, 3, 1, 3, Blocks.STONE);
  s.fill(2, -3, 2, 2, 1, 2, Blocks.AIR);                   // o poço em si
  s.put(2, -4, 2, Blocks.SAND);
  for (const [px, pz] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
    s.fill(px, 2, pz, px, 3, pz, Blocks.WOOD);             // esteios
  }
  gableRoof(s, 1, 1, 3, 3, 4, Blocks.WOOD, 0);
  return { kind: 'poco', w, d, door: null, blocks: s.blocks() };
}

// Roça cercada: canteiros de terra com pé de folhagem, cerca de madeira e um
// portão. Dá ao bot um destino que não é uma casa.
function roca(rnd) {
  const s = sketch();
  const w = 9, d = 7;

  s.fill(0, 0, 0, w - 1, 0, d - 1, Blocks.DIRT);
  s.fill(0, 1, 0, w - 1, 2, d - 1, Blocks.AIR);
  for (let z = 2; z <= d - 3; z++) {
    for (let x = 2; x <= w - 3; x++) {
      if ((z - 2) % 2 === 0 && rnd() < 0.85) s.put(x, 1, z, Blocks.LEAVES);
    }
  }
  // Cerca de 1 bloco: dá para pular para dentro, e é o que separa a roça do mato.
  s.walls(0, 1, 0, w - 1, 1, d - 1, Blocks.WOOD);
  const gate = Math.floor(w / 2);
  s.fill(gate, 1, 0, gate, 2, 0, Blocks.AIR);
  return { kind: 'roca', w, d, door: { x: gate, z: -1 }, blocks: s.blocks() };
}

// Sobrado: dois andares com escada interna e sacada na frente — a casa da
// primeira imagem de referência.
function sobrado(rnd) {
  const s = sketch();
  const w = 9, d = 8;
  const wall = rnd() < 0.5 ? Blocks.WOOD : Blocks.STONE;

  s.fill(0, -1, 0, w - 1, -1, d - 1, Blocks.STONE);
  s.fill(0, 0, 0, w - 1, 0, d - 1, Blocks.WOOD);

  // Térreo
  s.fill(1, 1, 1, w - 2, 3, d - 2, Blocks.AIR);
  s.walls(0, 1, 0, w - 1, 3, d - 1, wall);
  const doorX = Math.floor(w / 2);
  doorway(s, doorX, 0);
  window1(s, 2, 2, 0); window1(s, w - 3, 2, 0);
  window1(s, 0, 2, 3); window1(s, w - 1, 2, 3);

  // Laje do primeiro andar. O vão da escada acompanha os degraus: sem ele, a
  // laje vira teto baixo e a subida trava no meio.
  s.fill(0, 4, 0, w - 1, 4, d - 1, Blocks.WOOD);
  s.fill(w - 2, 4, 1, w - 2, 4, 3, Blocks.AIR);

  // Escada interna encostada na parede direita, chegando à laje em (w-2, 4, 4).
  staircase(s, w - 2, 1, 0, 1, 1, 3, Blocks.WOOD, 1);
  s.fill(w - 2, 5, 4, w - 2, 6, 4, Blocks.AIR);   // desembarque livre lá em cima

  // Andar de cima
  s.fill(1, 5, 1, w - 2, 7, d - 2, Blocks.AIR);
  s.walls(0, 5, 0, w - 1, 7, d - 1, wall);
  window1(s, 2, 6, 0); window1(s, doorX, 6, 0); window1(s, w - 3, 6, 0);
  window1(s, 0, 6, 3); window1(s, w - 1, 6, 3);
  s.fill(0, 8, 0, w - 1, 8, d - 1, Blocks.WOOD);
  gableRoof(s, 0, 0, w - 1, d - 1, 9, Blocks.LEAVES);

  // Sacada sobre a varanda, e a varanda embaixo dela
  s.fill(0, 0, -2, w - 1, 0, -1, Blocks.WOOD);
  s.fill(0, 1, -2, w - 1, 3, -1, Blocks.AIR);
  s.fill(0, 1, -2, 0, 3, -2, Blocks.WOOD);
  s.fill(w - 1, 1, -2, w - 1, 3, -2, Blocks.WOOD);
  s.fill(0, 4, -2, w - 1, 4, -1, Blocks.WOOD);
  s.fill(doorX, 0, -3, doorX, 0, -3, Blocks.WOOD);
  s.fill(doorX, 1, -3, doorX, 2, -3, Blocks.AIR);

  return { kind: 'sobrado', w, d, door: { x: doorX, z: -3 }, blocks: s.blocks() };
}

const KINDS = { cabana, palafita, torre, poco, roca, sobrado };

export const STRUCTURE_KINDS = Object.keys(KINDS);

/**
 * Planta de uma construção em coordenadas locais.
 * @param {string} kind  uma de STRUCTURE_KINDS
 * @param {() => number} rnd  aleatoriedade injetada (determinismo nos testes)
 * @returns {{kind, w, d, door, blocks: Array<[number,number,number,number]>}}
 */
export function planStructure(kind, rnd = Math.random) {
  const make = KINDS[kind];
  if (!make) throw new Error(`construção desconhecida: ${kind}`);
  return make(rnd);
}

/** Área ocupada no plano XZ, incluindo varanda e escada (que saem do retângulo). */
export function footprint(plan) {
  let x0 = 0, z0 = 0, x1 = plan.w - 1, z1 = plan.d - 1;
  for (const [x, , z] of plan.blocks) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}
