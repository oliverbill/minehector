// Ovelhas, caça e fôlego — o laço todo, do bicho pastando à carne comida.
//
// O que dá para afirmar sem tela: a ovelha fica em pé no chão, não sai correndo
// de quem só passa perto, foge de quem bate, morre no número certo de golpes e é
// acertável pela mira — que é a MESMA mira dos blocos e tem de decidir qual dos
// dois o clique acerta. Do outro lado, o fôlego: correr gasta mais que andar,
// zerado tira a corrida, e a carne repõe.
//
// A caça é testada pela Interaction de verdade, e não chamando `hurt` na mão: o
// defeito que interessa não é a ovelha perder vida, é o clique ir parar no bloco
// atrás dela (ou atravessar a parede na frente dela).

import { test, assert, assertEqual } from './tiny-test.mjs';
import {
  Sheep, SheepBrain, SheepManager,
  SHEEP_HEALTH, SHEEP_HEIGHT, WALK_SPEED, FLEE_SPEED, FALL_TIME, FLEE_TIME,
} from '../js/mobs/sheep.js';
import { CARNE_POR_OVELHA } from '../js/player/interaction.js';
import { REFEICAO, SEM_FOLEGO, DRENO_ANDANDO, DRENO_CORRENDO } from '../js/player/player.js';
import { moveEntity } from '../js/player/physics.js';
import { flatWorld, scene, createInput, Blocks } from './harness.mjs';
import { Player } from '../js/player/player.js';

/** Cena de mentira que sabe dizer quem está nela — é o que prova o recolhimento. */
function palco() {
  const dentro = new Set();
  return { dentro, add: (o) => dentro.add(o), remove: (o) => dentro.delete(o) };
}

/** Campo de grama largo o bastante para o anel de nascimento (14–34 blocos). */
const campo = () => flatWorld(40, 96, Blocks.GRASS);

// --- o cérebro, sem corpo ----------------------------------------------------

test('ovelha não foge de quem só passa perto', () => {
  const b = new SheepBrain(() => 0.5);
  for (let i = 0; i < 200; i++) {
    b.update(0.3, { x: 0, z: 0, playerDist: 1.2 });
    assert(b.state !== 'flee', 'a ovelha entrou em pânico sem ninguém tocar nela');
  }
});

test('depois da pancada ela dispara para longe de quem bateu', () => {
  const b = new SheepBrain(() => 0.5);
  b.update(0.3, { x: 10, z: 10, playerDist: 1 });
  b.panic(12, 10);                     // pancada vinda do lado +X
  assertEqual(b.state, 'flee', 'apanhou e não fugiu');
  assert(b.target.x < 10, `fugiu para o lado de quem bateu (x ${b.target.x})`);
});

test('o pânico passa e a ovelha volta a pastar', () => {
  const b = new SheepBrain(() => 0.5);
  b.panic(1, 0);
  let t = 0;
  while (b.state === 'flee' && t < FLEE_TIME * 3) {
    b.update(0.3, { x: 0, z: 0, playerDist: 40 });
    t += 0.3;
  }
  assert(b.state !== 'flee', 'a ovelha ficou fugindo para sempre');
  assert(t <= FLEE_TIME + 0.6, `demorou ${t}s para se acalmar`);
});

// --- o corpo -----------------------------------------------------------------

test('a ovelha cai, assenta no chão e fica de pé', () => {
  const { world, floor } = flatWorld(40, 20);
  const s = new Sheep({ x: 5.5, y: floor + 4, z: 5.5 }, () => 0.5);
  for (let i = 0; i < 120; i++) moveEntity(world, s, 1 / 60);
  assertEqual(s.pos.y, floor, `a ovelha parou em y ${s.pos.y}, e o chão é ${floor}`);
  assert(s.onGround, 'a ovelha não se dá por assentada');
});

test('a ovelha anda mais devagar que o jogador, e em pânico quase o alcança', () => {
  assert(WALK_SPEED < 4.3, 'ovelha pastando não pode andar mais que o jogador');
  assert(FLEE_SPEED > 4.3, 'ovelha em pânico tem de exigir corrida para ser pega');
  assert(FLEE_SPEED < 5.6, 'e não pode ser mais rápida que a corrida, senão nunca se caça');
});

test('morre no número certo de golpes, tomba e só então sai de cena', () => {
  const { world, floor } = flatWorld(40, 20);
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 0, { x: 5.5, z: 5.5 }, () => 0.5);
  const s = new Sheep({ x: 5.5, y: floor, z: 5.5 }, () => 0.5);
  rebanho.sheep.push(s);
  cena.add(s.mesh);

  for (let i = 1; i < SHEEP_HEALTH; i++) {
    assertEqual(s.hurt(1, { x: 4, z: 5.5 }), false, `morreu cedo, no golpe ${i}`);
    assert(!s.dead, 'caiu antes da hora');
  }
  assertEqual(s.hurt(1, { x: 4, z: 5.5 }), true, 'não morreu no último golpe');
  assertEqual(s.hurt(1), false, 'a morta morreu de novo — daria carne infinita');
  assert(s.tombando, 'morreu e nem tombou');
  assert(cena.dentro.has(s.mesh), 'sumiu da cena no mesmo instante, sem tombo');

  for (let i = 0; i < Math.ceil(FALL_TIME * 60) + 4; i++) {
    rebanho.update(1 / 60, { x: 5.5, y: floor, z: 5.5 });
  }
  assert(!cena.dentro.has(s.mesh), 'o corpo ficou na cena depois do tombo');
  assert(!rebanho.sheep.includes(s), 'a morta continua no rebanho');
});

test('o rebanho nasce na grama e segue o jogador pelo mundo', () => {
  const { world, floor } = campo();
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 4, { x: 48.5, z: 48.5 });
  assertEqual(rebanho.sheep.length, 4, 'o rebanho não nasceu no campo de grama');
  for (const s of rebanho.sheep) {
    assertEqual(world.getBlock(Math.floor(s.pos.x), floor - 1, Math.floor(s.pos.z)),
      Blocks.GRASS, 'ovelha nascida fora da grama');
    const d = Math.hypot(s.pos.x - 48.5, s.pos.z - 48.5);
    assert(d >= 14 && d <= 35, `nasceu a ${d.toFixed(1)} blocos — perto ou longe demais`);
  }

  // O jogador se muda para o outro canto: as de lá são recolhidas e nascem
  // outras por perto, senão o rebanho fica para trás e o mundo esvazia.
  const longe = { x: 48.5 + 200, y: floor, z: 48.5 };
  for (let i = 0; i < 30; i++) rebanho.update(1 / 60, longe);
  assert(rebanho.sheep.every((s) => Math.hypot(s.pos.x - longe.x, s.pos.z - longe.z) < 80),
    'ficou ovelha esquecida do outro lado do mundo');
});

// --- a mira: ovelha e bloco disputam o mesmo clique --------------------------

// A ovelha tem 1,3 e o olho do jogador está a 1,62: mirar em frente passa por
// cima dela. Quem caça olha para baixo — e é esse o pitch que os testes usam.
const PITCH_OVELHA = -0.31;   // rad: do olho ao corpo de uma ovelha a 3 blocos

test('a mira acerta a ovelha à frente e erra o vazio', () => {
  const { world, floor } = flatWorld(40, 20);
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 0, { x: 5.5, z: 5.5 }, () => 0.5);
  rebanho.sheep.push(new Sheep({ x: 5.5, y: floor, z: 2.5 }, () => 0.5));

  const olho = { x: 5.5, y: floor + 1.62, z: 5.5 };
  const paraBaixo = { x: 0, y: Math.sin(PITCH_OVELHA), z: -Math.cos(PITCH_OVELHA) };
  const reto = { x: 0, y: 0, z: -1 };
  assert(rebanho.raycast(olho, paraBaixo, 6), 'a ovelha bem à frente não foi mirada');
  assert(!rebanho.raycast(olho, reto, 6),
    `mira reta passou por cima: a ovelha tem ${SHEEP_HEIGHT} e o olho está a 1,62`);
  assert(!rebanho.raycast(olho, { x: 0, y: 0, z: 1 }, 6), 'mirou uma ovelha que está atrás');
  assert(!rebanho.raycast(olho, paraBaixo, 1.5), 'acertou uma ovelha fora do alcance');
});

test('clicar na ovelha caça em vez de quebrar o bloco atrás dela', () => {
  const { world, floor } = flatWorld(40, 20);
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 0, { x: 5.5, z: 5.5 }, () => 0.5);
  const s = new Sheep({ x: 5.5, y: floor, z: 2.5 }, () => 0.5);
  rebanho.sheep.push(s);

  // Parede logo atrás da ovelha: sem a disputa de mira, o clique iria nela.
  const parede = { x: 5, y: floor, z: 1 };
  world.setBlock(parede.x, parede.y, parede.z, Blocks.STONE);

  const jogo = scene(world, { x: 5.5, y: floor, z: 5.5 }, rebanho);
  jogo.player.pitch = PITCH_OVELHA;
  jogo.click(0);
  assertEqual(s.health, SHEEP_HEALTH - 1, 'a picaretada não pegou na ovelha');
  assertEqual(world.getBlock(parede.x, parede.y, parede.z), Blocks.STONE,
    'o golpe atravessou a ovelha e quebrou a parede atrás');
});

test('ovelha atrás da parede não é caçada através dela', () => {
  const { world, floor } = flatWorld(40, 20);
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 0, { x: 5.5, z: 5.5 }, () => 0.5);
  const s = new Sheep({ x: 5.5, y: floor, z: 2.5 }, () => 0.5);
  rebanho.sheep.push(s);
  // Parede entre os dois, da altura dos pés à do olho.
  for (let y = floor; y < floor + 3; y++) world.setBlock(5, y, 4, Blocks.STONE);

  const jogo = scene(world, { x: 5.5, y: floor, z: 5.5 }, rebanho);
  jogo.player.pitch = PITCH_OVELHA;
  jogo.click(0);
  assertEqual(s.health, SHEEP_HEALTH, 'a ovelha apanhou através da parede');
  assertEqual(world.getBlock(5, floor + 1, 4), Blocks.AIR, 'a parede é que devia ter levado');
});

test('derrubar a ovelha põe carne no bolso', () => {
  const { world, floor } = flatWorld(40, 20);
  const cena = palco();
  const rebanho = new SheepManager(cena, world, 0, { x: 5.5, z: 5.5 }, () => 0.5);
  const s = new Sheep({ x: 5.5, y: floor, z: 2.5 }, () => 0.5);
  rebanho.sheep.push(s);

  const jogo = scene(world, { x: 5.5, y: floor, z: 5.5 }, rebanho);
  jogo.player.pitch = PITCH_OVELHA;
  assertEqual(jogo.player.carne, 0, 'o jogador começou com carne no bolso');
  for (let i = 0; i < SHEEP_HEALTH; i++) jogo.click(0);
  assertEqual(jogo.player.carne, CARNE_POR_OVELHA, 'a ovelha caiu e não deu carne');

  jogo.click(0);   // insistir no corpo caído não pode render mais nada
  assertEqual(jogo.player.carne, CARNE_POR_OVELHA, 'o cadáver virou fonte infinita de carne');
});

// --- fôlego ------------------------------------------------------------------

/** Anda `segundos` para a frente e devolve o fôlego gasto. */
function correr(segundos, { correndo }) {
  const { world, floor } = flatWorld(40, 20);
  const player = new Player(world, { x: 5.5, y: floor, z: 5.5 });
  const input = createInput();
  input.hold('KeyW');
  if (correndo) input.hold('ShiftLeft');
  const antes = player.folego;
  for (let i = 0; i < segundos * 60; i++) player.update(1 / 60, input);
  return antes - player.folego;
}

test('andar cansa, e correr cansa bem mais', () => {
  const andando = correr(3, { correndo: false });
  const disparado = correr(3, { correndo: true });
  assert(andando > 0, 'andar não gastou fôlego nenhum');
  assert(disparado > andando * 2, `correr gastou ${disparado} contra ${andando} andando`);
  // A conta tem de bater com as constantes, senão o número da HUD é decorativo.
  assert(Math.abs(andando - DRENO_ANDANDO * 3) < DRENO_ANDANDO,
    `gasto de ${andando} não casa com ${DRENO_ANDANDO}/s`);
  assert(Math.abs(disparado - DRENO_CORRENDO * 3) < DRENO_CORRENDO,
    `gasto de ${disparado} não casa com ${DRENO_CORRENDO}/s`);
});

test('parado não cansa ninguém', () => {
  const { world, floor } = flatWorld(40, 20);
  const player = new Player(world, { x: 5.5, y: floor, z: 5.5 });
  const input = createInput();
  for (let i = 0; i < 600; i++) player.update(1 / 60, input);
  assertEqual(player.folego, 1, 'o jogador cansou olhando a paisagem');
});

test('sem fôlego não se corre, e a passada encurta', () => {
  const { world, floor } = flatWorld(40, 20);
  const player = new Player(world, { x: 5.5, y: floor, z: 5.5 });
  const input = createInput();
  input.hold('KeyW');
  input.hold('ShiftLeft');

  player.folego = 1;
  player.update(1 / 60, input);
  const comGas = Math.hypot(player.vel.x, player.vel.z);

  player.folego = 0;
  player.update(1 / 60, input);
  const semGas = Math.hypot(player.vel.x, player.vel.z);

  assert(player.exausto, 'zerado o fôlego, o jogador não se diz exausto');
  assert(semGas < comGas * 0.75, `exausto continuou rápido: ${semGas} contra ${comGas}`);
  assert(Math.abs(semGas - 4.3 * SEM_FOLEGO) < 0.05, `a passada de exausto ficou em ${semGas}`);
});

test('comer repõe o fôlego e gasta uma carne', () => {
  const { world, floor } = flatWorld(40, 20);
  const player = new Player(world, { x: 5.5, y: floor, z: 5.5 });
  assertEqual(player.comer(), 'sem carne', 'comeu do bolso vazio');

  player.carne = 2;
  player.folego = 0.1;
  assertEqual(player.comer(), 'comeu', 'com carne e com fome, não comeu');
  assertEqual(player.carne, 1, 'a carne não saiu do bolso');
  assert(Math.abs(player.folego - (0.1 + REFEICAO)) < 1e-9, 'a refeição repôs a conta errada');

  player.folego = 1;
  assertEqual(player.comer(), 'cheio', 'comeu de barriga cheia e desperdiçou carne');
  assertEqual(player.carne, 1, 'perdeu carne comendo sem fome');

  player.folego = 0.9;
  player.comer();
  assertEqual(player.folego, 1, 'a refeição passou de 1');
});
