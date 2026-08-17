// Construções: o que se promete é que dá para entrar nelas. O teste anda pelo
// mundo como o jogo anda — 1,8 de altura (duas células livres), degrau de no
// máximo 1 bloco, que é o que o pulo vence — e exige que os pontos de dentro
// sejam alcançáveis a partir de fora. Se alguém fechar uma porta ou levantar um
// degrau, isto cai.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { flatWorld, Blocks } from './harness.mjs';
import { planStructure, STRUCTURE_KINDS, footprint } from '../js/world/structures.js';
import {
  Village, BuildJob, MAX_STRUCTURES, SPAWN_CLEAR, VILLAGE_RADIUS, VILLAGE_RADIUS_MAX,
} from '../js/bots/village.js';
import { Owner } from '../js/constants.js';

// rng determinístico para o teste não depender da sorte
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function build(world, kind, origin, rnd = seeded(7)) {
  const plan = planStructure(kind, rnd);
  for (const [x, y, z, id] of plan.blocks) {
    world.setBlock(origin.x + x, origin.y + y, origin.z + z, id);
  }
  return plan;
}

// Célula onde se pode ficar de pé: chão sólido embaixo, duas livres para o corpo.
function standable(world, x, y, z) {
  return world.isSolid(x, y - 1, z)
    && !world.isSolid(x, y, z)
    && !world.isSolid(x, y + 1, z);
}

// Alcançáveis a partir de (x,y,z), com as regras de movimento do jogo.
function reachable(world, start, limit = 20000) {
  const seen = new Set();
  const queue = [start];
  seen.add(`${start.x},${start.y},${start.z}`);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length && seen.size < limit) {
    const cur = queue.shift();
    for (const [dx, dz] of dirs) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;
      // Subir no máximo 1 (pulo), descer o que for (queda).
      for (let dy = 1; dy >= -3; dy--) {
        const ny = cur.y + dy;
        if (ny < 1) continue;
        if (!standable(world, nx, ny, nz)) continue;
        // Para subir um degrau é preciso ter espaço acima da cabeça na origem.
        if (dy === 1 && world.isSolid(cur.x, cur.y + 2, cur.z)) continue;
        const k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny, z: nz });
        break; // primeiro apoio encontrado nesta direção
      }
    }
  }
  return seen;
}

// Pontos que precisam ser alcançáveis, em coordenadas locais (y relativo ao piso).
const INTERIORES = {
  cabana: [[3, 1, 3]],
  palafita: [[3, 4, 3]],
  torre: [[2, 1, 2], [2, 11, 2]],   // térreo e a sacada, subindo pela escada
  roca: [[4, 1, 3]],
  sobrado: [[4, 1, 4], [4, 5, 4]],  // térreo e o andar de cima
};

for (const kind of STRUCTURE_KINDS) {
  test(`${kind}: dá para entrar vindo de fora`, () => {
    const { world, floor } = flatWorld(40, 64);
    const origin = { x: 20, y: floor, z: 20 };
    build(world, kind, origin);

    const alvos = INTERIORES[kind];
    if (!alvos) return;   // poço não tem interior habitável, só o buraco

    const start = { x: origin.x + 4, y: floor, z: origin.z - 12 };  // do lado de fora
    assert(standable(world, start.x, start.y, start.z), 'ponto de partida inválido');
    const vistos = reachable(world, start);

    for (const [lx, ly, lz] of alvos) {
      const k = `${origin.x + lx},${origin.y + ly},${origin.z + lz}`;
      assert(vistos.has(k), `não se chega a (${lx},${ly},${lz}) de dentro da ${kind}`);
    }
  });
}

test('poço: o buraco fica aberto e tem fundo', () => {
  const { world, floor } = flatWorld(40, 64);
  const origin = { x: 20, y: floor, z: 20 };
  build(world, 'poco', origin);
  assert(!world.isSolid(origin.x + 2, origin.y, origin.z + 2), 'boca do poço tapada');
  assert(!world.isSolid(origin.x + 2, origin.y - 2, origin.z + 2), 'poço sem profundidade');
  assert(world.isSolid(origin.x + 2, origin.y - 4, origin.z + 2), 'poço sem fundo');
});

test('toda construção tem vão de porta de 2 blocos', () => {
  for (const kind of STRUCTURE_KINDS) {
    const plan = planStructure(kind, seeded(3));
    if (!plan.door) continue;
    const { world, floor } = flatWorld(40, 64);
    const origin = { x: 20, y: floor, z: 20 };
    build(world, kind, origin, seeded(3));
    const dx = origin.x + plan.door.x;
    const dz = origin.z + plan.door.z;
    // Anda da porta para dentro procurando o vão: ele está a 1 ou 2 células.
    let achou = false;
    for (let step = 0; step <= 4 && !achou; step++) {
      for (let dy = 0; dy <= 6; dy++) {
        const y = origin.y + dy;
        if (!world.isSolid(dx, y, dz + step) && !world.isSolid(dx, y + 1, dz + step)
          && world.isSolid(dx, y - 1, dz + step)) { achou = true; break; }
      }
    }
    assert(achou, `${kind}: não achei vão de 2 blocos na porta`);
  }
});

test('nenhuma construção enterra o interior em bloco sólido', () => {
  for (const kind of STRUCTURE_KINDS) {
    const alvos = INTERIORES[kind];
    if (!alvos) continue;
    const { world, floor } = flatWorld(40, 64);
    const origin = { x: 20, y: floor, z: 20 };
    build(world, kind, origin);
    for (const [lx, ly, lz] of alvos) {
      assert(standable(world, origin.x + lx, origin.y + ly, origin.z + lz),
        `${kind}: (${lx},${ly},${lz}) não é lugar de ficar de pé`);
    }
  }
});

// --- a aldeia -------------------------------------------------------------

test('a aldeia não empilha construção em cima de construção', () => {
  const { world } = flatWorld(40, 96);
  const aldeia = new Village(world, { x: 8.5, z: 8.5 }, seeded(11));
  const feitas = [];
  for (let i = 0; i < MAX_STRUCTURES * 3; i++) {
    const job = aldeia.planNear(40 + (i % 5) * 6, 40 + (i % 7) * 5);
    if (job) feitas.push(job);
  }
  assert(aldeia.structures.length > 1, `só ${aldeia.structures.length} construção`);
  assertEqual(aldeia.structures.length <= MAX_STRUCTURES, true, 'passou do teto');
  for (let i = 0; i < aldeia.structures.length; i++) {
    for (let j = i + 1; j < aldeia.structures.length; j++) {
      const a = aldeia.structures[i].bounds;
      const b = aldeia.structures[j].bounds;
      const sobrepoe = a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
      assert(!sobrepoe, `construções ${i} e ${j} se sobrepõem`);
    }
  }
});

test('a aldeia respeita o espaço do spawn do jogador', () => {
  const { world } = flatWorld(40, 96);
  const spawn = { x: 8.5, z: 8.5 };
  const aldeia = new Village(world, spawn, seeded(5));
  for (let i = 0; i < 20; i++) aldeia.planNear(spawn.x, spawn.z);
  assert(aldeia.structures.length > 0, 'não planejou nada para conferir');
  for (const s of aldeia.structures) {
    // Beirada, não centro: uma casa larga com o centro a 7 tem parede a 3.
    const bx = Math.max(s.bounds.x0 - spawn.x, spawn.x - s.bounds.x1, 0);
    const bz = Math.max(s.bounds.z0 - spawn.z, spawn.z - s.bounds.z1, 0);
    assert(Math.hypot(bx, bz) >= SPAWN_CLEAR, 'construção encostando no spawn');
  }
});

test('a aldeia fica ao alcance de uma caminhada, mesmo com o bot longe', () => {
  const { world } = flatWorld(40, 160);
  const spawn = { x: 8.5, z: 8.5 };
  const aldeia = new Village(world, spawn, seeded(9));

  // O bot pede obra lá do fim do mundo: é o caso real, porque eles vagueiam.
  // Antes disto a casa nascia junto do bot e o jogador tinha de caçá-la.
  for (let i = 0; i < 40; i++) aldeia.planNear(spawn.x + 70, spawn.z + 70);

  assert(aldeia.structures.length > 0, 'nenhuma obra planejada');
  for (const s of aldeia.structures) {
    const cx = (s.bounds.x0 + s.bounds.x1) / 2;
    const cz = (s.bounds.z0 + s.bounds.z1) / 2;
    const d = Math.hypot(cx - spawn.x, cz - spawn.z);
    // VILLAGE_RADIUS_MAX e não VILLAGE_RADIUS: o tipo que não acha lugar dentro
    // do raio normal vai afrouxando o dele, senão o sobrado — a maior planta —
    // simplesmente não é construído. O teto continua sendo uma caminhada curta.
    assert(d <= VILLAGE_RADIUS_MAX, `construção a ${Math.round(d)} blocos do spawn`);
  }
});

test('a aldeia levanta uma de cada: as seis, sem repetir', () => {
  const { world } = flatWorld(40, 200);
  const spawn = { x: 8.5, z: 8.5 };
  const aldeia = new Village(world, spawn, seeded(31));
  for (let i = 0; i < 200 && !aldeia.full; i++) aldeia.planNear(spawn.x, spawn.z);

  const tipos = aldeia.structures.map((s) => s.kind);
  assertEqual(tipos.length, STRUCTURE_KINDS.length, `saíram ${tipos.length}: ${tipos.join(', ')}`);
  assertEqual(new Set(tipos).size, tipos.length, `tipo repetido: ${tipos.join(', ')}`);
  for (const kind of STRUCTURE_KINDS) {
    assert(tipos.includes(kind), `faltou ${kind} — o jogador pediu todas`);
  }
  assertEqual(aldeia.pending.length, 0, 'sobrou pendência com a aldeia cheia');
});

test('a bússola aponta a construção mais próxima, e prefere a que está em obra', () => {
  const { world } = flatWorld(40, 200);
  const spawn = { x: 8.5, z: 8.5 };
  const aldeia = new Village(world, spawn, seeded(33));

  assertEqual(aldeia.nearest(spawn.x, spawn.z), null, 'apontou algo numa aldeia vazia');

  const jobs = [];
  for (let i = 0; i < 200 && !aldeia.full; i++) {
    const j = aldeia.planNear(spawn.x, spawn.z);
    if (j) jobs.push(j);
  }
  assert(aldeia.structures.length >= 2, 'poucas construções para comparar');

  // Termina todas menos a última: a bússola tem de apontar a que ficou em obra,
  // ainda que outra esteja mais perto — o que vale ver é o bloco sendo assentado.
  for (const j of jobs.slice(0, -1)) for (let i = 0; i < 4000 && !j.done; i++) j.step(1, []);
  const emObra = aldeia.structures[aldeia.structures.length - 1];
  const alvo = aldeia.nearest(spawn.x, spawn.z);
  assert(alvo.emObra, 'apontou casa pronta havendo obra em andamento');
  assertEqual(alvo.kind, emObra.kind, 'apontou a obra errada');

  // Com tudo pronto, volta a valer a distância.
  for (const j of jobs) for (let i = 0; i < 4000 && !j.done; i++) j.step(1, []);
  const depois = aldeia.nearest(spawn.x, spawn.z);
  const maisPerto = aldeia.structures
    .map((s) => Math.hypot(s.origin.x - spawn.x, s.origin.z - spawn.z))
    .sort((a, b) => a - b)[0];
  assert(Math.abs(depois.dist - maisPerto) < 1e-9, 'não apontou a mais próxima');
});

test('a aldeia é feita de casas, não de um campo de poços', () => {
  const PEQUENAS = ['poco', 'roca'];
  const { world } = flatWorld(40, 160);
  const spawn = { x: 8.5, z: 8.5 };

  for (const semente of [11, 12, 13]) {
    const aldeia = new Village(world, spawn, seeded(semente));
    for (let i = 0; i < 40; i++) aldeia.planNear(spawn.x, spawn.z);
    const tipos = aldeia.structures.map((s) => s.kind);
    assert(tipos.length >= 3, `semente ${semente}: só ${tipos.length} construções`);

    // O sorteio uniforme dava três poços numa aldeia de quatro: o poço é o menor
    // de todos, e pequeno passa nos testes de terreno muito mais vezes. Repetir
    // tipo é aceitável quando o grande já não cabe no raio; o que não pode é a
    // aldeia inteira virar a mesma coisa pequena.
    const casas = tipos.filter((t) => !PEQUENAS.includes(t));
    assert(casas.length >= Math.ceil(tipos.length / 2),
      `semente ${semente}: só ${casas.length} casas em ${tipos.length} (${tipos.join(', ')})`);
    assert(new Set(tipos.slice(0, 3)).size === Math.min(3, tipos.length),
      `semente ${semente}: as três primeiras se repetem (${tipos.join(', ')})`);
  }
});

test('a primeira construção é uma casa, não um poço', () => {
  const { world } = flatWorld(40, 160);
  for (const semente of [1, 2, 3, 4, 5]) {
    const aldeia = new Village(world, { x: 8.5, z: 8.5 }, seeded(semente));
    aldeia.planNear(8.5, 8.5);
    const primeira = aldeia.structures[0];
    assert(primeira, `semente ${semente}: não planejou nada`);
    assert(primeira.kind !== 'poco' && primeira.kind !== 'roca',
      `semente ${semente}: a primeira coisa que o jogador vê é um ${primeira.kind}`);
  }
});

test('obra nova não nasce em cima de casa de sessão anterior', () => {
  const { world, floor } = flatWorld(40, 160);
  const spawn = { x: 8.5, z: 8.5 };

  // Sessão 1: levanta tudo até o fim.
  const s1 = new Village(world, spawn, seeded(21));
  const jobs = [];
  for (let i = 0; i < 40; i++) {
    const j = s1.planNear(spawn.x, spawn.z);
    if (j) jobs.push(j);
  }
  for (const j of jobs) for (let i = 0; i < 3000 && !j.done; i++) j.step(1, []);
  assert(s1.structures.length > 0, 'a sessão 1 não construiu nada');

  // Sessão 2: o jogo recarregou. A aldeia nasce vazia, mas as casas continuam
  // salvas no mundo — só a posse das células sabe que elas existem.
  const s2 = new Village(world, spawn, seeded(22));
  for (let i = 0; i < 40; i++) s2.planNear(spawn.x, spawn.z);

  for (const b of s2.structures) {
    for (const a of s1.structures) {
      const dx = Math.max(a.bounds.x0 - b.bounds.x1, b.bounds.x0 - a.bounds.x1, 0);
      const dz = Math.max(a.bounds.z0 - b.bounds.z1, b.bounds.z0 - a.bounds.z1, 0);
      assert(dx > 0 || dz > 0,
        `${b.kind} novo caiu em cima da ${a.kind} de antes (${a.bounds.x0},${a.bounds.z0})`);
    }
  }
});

test('a obra termina mesmo com alguém plantado em cima dela', () => {
  const { world, floor } = flatWorld(40, 64);
  const origin = { x: 20, y: floor, z: 20 };
  const plan = planStructure('cabana', seeded(3));
  const job = new BuildJob(world, origin, plan);

  // Um teimoso parado bem no meio da planta, que nunca sai. Antes, o bloco
  // debaixo dele voltava para o fim da fila eternamente e a casa não ficava
  // pronta nunca — inclusive quando o teimoso era o próprio pedreiro.
  const teimoso = { pos: { x: origin.x + 2.5, y: origin.y, z: origin.z + 2.5 }, width: 0.6, height: 1.8 };
  const yInicial = teimoso.pos.y;
  for (let i = 0; i < 4000 && !job.done; i++) job.step(1 / 60, [teimoso]);

  assert(job.done, `obra parada com ${job.queue.length} blocos na fila`);
  assert(teimoso.pos.y > yInicial, 'o teimoso não foi posto por cima do bloco assentado');
});

test('o pedreiro não fica em cima da própria planta', () => {
  const { world, floor } = flatWorld(40, 64);
  for (const kind of STRUCTURE_KINDS) {
    const plan = planStructure(kind, seeded(4));
    const origin = { x: 20, y: floor, z: 20 };
    const job = new BuildJob(world, origin, plan);
    const p = job.standPoint;
    const fp = footprint(plan);
    const lz = Math.floor(p.z) - origin.z;
    assert(lz < fp.z0, `${kind}: o pedreiro para em z local ${lz}, dentro da planta (z0=${fp.z0})`);
  }
});

test('buraco cavado pelo jogador não espanta a obra do lugar', () => {
  const { world, floor } = flatWorld(40, 96);
  const spawn = { x: 8.5, z: 8.5 };

  // Quem joga quebra grama por onde anda: dezenas de células de ar viram dele.
  // Isso não pode custar o sítio, senão a aldeia foge de quem mais joga.
  //
  // O trecho cavado é um quintal em volta do spawn, não o mapa inteiro: onde o
  // jogador de fato escavou, a obra continua recusando (encher o buraco dele é
  // mexer no trabalho dele), e o que se exige aqui é que o RESTO do raio siga
  // servindo.
  for (let x = 0; x <= 14; x++) {
    for (let z = 0; z <= 14; z++) {
      if ((x + z) % 3) continue;
      world.setBlock(x, floor - 1, z, Blocks.AIR, Owner.PLAYER);
    }
  }

  const aldeia = new Village(world, spawn, seeded(9));
  for (let i = 0; i < 40; i++) aldeia.planNear(spawn.x, spawn.z);
  assert(aldeia.structures.length >= 3,
    `só ${aldeia.structures.length} sítios num terreno onde o jogador só cavou`);
});

test('a obra é progressiva e termina exatamente igual à planta', () => {
  const { world, floor } = flatWorld(40, 64);
  const origin = { x: 20, y: floor, z: 20 };
  const plan = planStructure('cabana', seeded(9));
  const job = new BuildJob(world, origin, plan);

  assert(job.total > 100, `obra pequena demais: ${job.total} blocos`);
  let ticks = 0;
  while (!job.done && ticks < 10000) { job.step(1 / 60); ticks++; }
  assert(ticks > 30, `a obra terminou em ${ticks} frames — não é progressiva`);

  for (const [x, y, z, id] of plan.blocks) {
    assertEqual(world.getBlock(origin.x + x, origin.y + y, origin.z + z), id,
      `bloco (${x},${y},${z}) da planta`);
  }
});

test('a obra preenche o alicerce quando o terreno é irregular', () => {
  const { world, floor } = flatWorld(40, 64);
  // cava um degrau dentro do sítio
  for (let x = 20; x < 26; x++) for (let z = 20; z < 24; z++) world.setBlock(x, floor - 1, z, Blocks.AIR);
  const origin = { x: 20, y: floor, z: 20 };
  const job = new BuildJob(world, origin, planStructure('cabana', seeded(9)));
  while (!job.done) job.step(1);
  assert(world.isSolid(22, floor - 1, 22), 'ficou buraco sob a construção');
});
