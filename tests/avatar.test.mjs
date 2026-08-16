// Avatar dos bots. O que se pode afirmar sem GPU: a montagem (peças, pivôs,
// altura), o determinismo pelo nome e a animação (a passada acompanha a
// velocidade, morre quando o bot para, e os braços sobem no ar).

import { test, assert, assertEqual } from './tiny-test.mjs';
import { createAvatar } from '../js/bots/avatar.js';

const ALTURA = 1.8;          // a AABB do bot (bot.js)
const U = ALTURA / 32;

const partes = (g) => g.children.filter((c) => c.type !== 'Sprite');
const bbox = (g) => {
  // Altura do topo da cabeça: o group tem origem nos pés.
  let top = 0;
  g.traverse((o) => {
    if (!o.geometry || !o.geometry.parameters) return;
    const world = o.position.y + (o.parent ? o.parent.position.y : 0);
    top = Math.max(top, world + o.geometry.parameters.height / 2);
  });
  return top;
};

test('boneco montado: cabeça, tronco, dois braços, duas pernas e o nome', () => {
  const a = createAvatar('Ana', 0xcc3333);
  assertEqual(partes(a.group).length, 6, 'peças do corpo');
  assertEqual(a.group.children.filter((c) => c.type === 'Sprite').length, 1, 'sprite de nome');
});

test('a altura do boneco casa com a AABB do bot', () => {
  const topo = bbox(createAvatar('Ana', 0xcc3333).group);
  assert(Math.abs(topo - ALTURA) < U, `topo da cabeça em ${topo.toFixed(3)}, AABB é ${ALTURA}`);
});

test('membros giram pelo ombro/quadril, não pelo meio', () => {
  const a = createAvatar('Beto', 0x3366cc);
  for (const pivo of partes(a.group)) {
    for (const peca of pivo.children || []) {
      if (!peca.geometry || !peca.geometry.parameters) continue;
      const h = peca.geometry.parameters.height;
      // Pendurado pelo topo: o centro da caixa fica meia altura abaixo do pivô.
      if (peca.position.y !== 0) {
        assert(Math.abs(peca.position.y + h / 2) < 1e-9,
          `peça pendurada em y=${peca.position.y}, esperado ${-h / 2}`);
      }
    }
  }
});

test('cada face tem textura própria (nada de boneco monocromático)', () => {
  const a = createAvatar('Ana', 0xcc3333);
  let caixas = 0;
  a.group.traverse((o) => {
    if (!o.isMesh) return;
    caixas++;
    assert(Array.isArray(o.material), 'a caixa não tem material por face');
    assertEqual(o.material.length, 6, 'materiais por caixa');
    for (const m of o.material) assert(m.map, 'face sem textura');
  });
  assert(caixas >= 6, `só ${caixas} caixas no boneco`);
});

test('o rosto é desenhado na face da frente (+Z), com olhos', () => {
  const a = createAvatar('Ana', 0xcc3333);
  const cabeca = partes(a.group).find((p) => p.children.some(
    (c) => c.geometry && c.geometry.parameters.height === c.geometry.parameters.depth
      && c.geometry.parameters.height === c.geometry.parameters.width));
  assert(cabeca, 'não achei a cabeça (única caixa cúbica)');
  const mesh = cabeca.children[0];
  const frente = mesh.material[4].map.image;   // índice 4 = +Z
  const costas = mesh.material[5].map.image;
  const brancos = (img) => img.ops.filter((o) => o.color === 'rgb(248,248,248)').length;
  assert(brancos(frente) >= 2, 'a face da frente não tem os dois olhos');
  assertEqual(brancos(costas), 0, 'desenhou olho na nuca');
});

test('o mesmo nome dá sempre o mesmo boneco', () => {
  const cores = (nome) => {
    const a = createAvatar(nome, 0xcc3333);
    const out = [];
    a.group.traverse((o) => {
      if (o.isMesh) for (const m of o.material) out.push(...m.map.image.ops.map((op) => op.color));
    });
    return out.join('|');
  };
  assertEqual(cores('Ana') === cores('Ana'), true, 'mesmo nome, bonecos diferentes');
  assert(cores('Ana') !== cores('Beto'), 'nomes diferentes deram o mesmo boneco');
});

test('a passada acompanha a velocidade e morre quando o bot para', () => {
  const a = createAvatar('Caio', 0xe6cc33);
  const perna = partes(a.group).find((p) => p.position.x === 2 * U && p.position.y === 12 * U);
  assert(perna, 'não achei a perna direita');

  let maxAndando = 0;
  for (let i = 0; i < 120; i++) {
    a.animate(1 / 60, 3.5, true);                 // WALK_SPEED dos bots
    maxAndando = Math.max(maxAndando, Math.abs(perna.rotation.x));
  }
  assert(maxAndando > 0.3, `perna quase parada andando: ${maxAndando.toFixed(3)}`);

  for (let i = 0; i < 240; i++) a.animate(1 / 60, 0, true);
  assert(Math.abs(perna.rotation.x) < 0.05,
    `perna continuou balançando parada: ${perna.rotation.x.toFixed(3)}`);
});

test('no ar os braços sobem', () => {
  const a = createAvatar('Ana', 0xcc3333);
  const bracos = partes(a.group).filter((p) => Math.abs(p.position.x) === 6 * U);
  assertEqual(bracos.length, 2, 'braços');
  a.animate(1 / 60, 2, false);
  for (const b of bracos) assert(b.rotation.x < -1, `braço em ${b.rotation.x.toFixed(2)}, esperado bem negativo`);
});

test('bots não marcham em sincronia', () => {
  const a = createAvatar('Ana', 0xcc3333);
  const b = createAvatar('Beto', 0x3366cc);
  const pernaDe = (av) => partes(av.group).find((p) => p.position.x === 2 * U && p.position.y === 12 * U);
  for (let i = 0; i < 30; i++) { a.animate(1 / 60, 3.5, true); b.animate(1 / 60, 3.5, true); }
  assert(Math.abs(pernaDe(a).rotation.x - pernaDe(b).rotation.x) > 1e-3, 'os dois no mesmo passo');
});
