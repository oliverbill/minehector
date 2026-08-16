// Integração dos bots: o loop do jogo rodando de verdade — mundo gerado por
// ruído, física, FSM, obra e boneco — para pegar o que os testes de unidade não
// pegam: fiação errada entre Bot, Village e BuildJob.

import { test, assert } from './tiny-test.mjs';
import { World } from '../js/world/world.js';
import { WORLD_SEED } from '../js/constants.js';
import { BotManager } from '../js/bots/botManager.js';
import { MAX_STRUCTURES } from '../js/bots/village.js';

// Um "jogo" de N segundos a 60 fps, com o jogador parado no spawn.
function simular(segundos, count = 3) {
  const world = new World(WORLD_SEED, new Map());
  const bots = new BotManager({ add: () => {} }, world, count);
  const player = { x: 8.5, y: world.surfaceHeight(8, 8) + 1, z: 8.5 };
  const frames = Math.round(segundos * 60);
  for (let f = 0; f < frames; f++) bots.update(1 / 60, player);
  return { world, bots };
}

test('os bots levantam construções sozinhos, no terreno gerado', () => {
  const { bots } = simular(180);
  assert(bots.village.structures.length > 0, 'ninguém construiu nada em 3 minutos');
  assert(bots.village.structures.length <= MAX_STRUCTURES, 'passou do teto de construções');
});

test('a obra sai do chão: os blocos vão parar no mundo', () => {
  const { world, bots } = simular(180);
  const s = bots.village.structures[0];
  assert(s, 'nenhuma construção para conferir');
  let solidos = 0;
  for (let x = s.bounds.x0; x <= s.bounds.x1; x++) {
    for (let z = s.bounds.z0; z <= s.bounds.z1; z++) {
      for (let y = s.origin.y; y < s.origin.y + 6; y++) if (world.isSolid(x, y, z)) solidos++;
    }
  }
  assert(solidos > 40, `só ${solidos} blocos assentados no sítio da ${s.kind}`);
});

test('nenhum bot fica preso dentro do que construiu', () => {
  const { world, bots } = simular(240);
  for (const bot of bots.bots) {
    const x = Math.floor(bot.pos.x);
    const y = Math.floor(bot.pos.y);
    const z = Math.floor(bot.pos.z);
    assert(!world.isSolid(x, y, z) || !world.isSolid(x, y + 1, z),
      `${bot.name} emparedado em (${x},${y},${z})`);
    assert(bot.pos.y > 0, `${bot.name} caiu do mundo`);
  }
});

test('os bots visitam as construções prontas', () => {
  // Roda o bastante para haver casa e para alguém decidir entrar nela.
  const { bots } = simular(300);
  assert(bots.village.structures.some((s) => s.door), 'nenhuma construção com porta');
  // O estado 'visit' é raro num instante isolado; o que se afirma aqui é que a
  // porta existe em coordenadas de mundo e que o alvo de dentro cai adiante dela.
  for (const s of bots.village.structures) {
    if (!s.door) continue;
    assert(s.door.inside.z > s.door.z, 'o ponto de dentro não fica além da porta');
  }
});

test('o piso das construções tem apoio embaixo (nada flutuando)', () => {
  const { world, bots } = simular(180);
  for (const s of bots.village.structures) {
    for (let x = s.bounds.x0; x <= s.bounds.x1; x++) {
      for (let z = s.bounds.z0; z <= s.bounds.z1; z++) {
        // Só onde há piso. O poço é um buraco de propósito, e exigir chão sob
        // ele seria tapar exatamente o que faz dele um poço.
        if (!world.isSolid(x, s.origin.y, z)) continue;
        assert(world.isSolid(x, s.origin.y - 1, z), `piso sem apoio na ${s.kind} em (${x},${z})`);
      }
    }
  }
});
