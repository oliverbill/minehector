// Controles de toque: o caminho que faz o jogo andar no iPhone e no iPad.
//
// O que dá para afirmar sem tela nem dedo é justamente o que quebrava: a conta
// do manche, o que o toque escreve no Input e o que o Player faz com isso. O
// arrasto e os botões são só DOM ligando um no outro — a regra que importa é que
// o jogo ande SEM pointer lock, porque no iPhone ele nunca vai existir.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { stickVector, isTouchDevice, STICK_RADIUS } from '../js/player/touch.js';
import { Input } from '../js/player/input.js';
import { Player } from '../js/player/player.js';
import { Interaction } from '../js/player/interaction.js';
import { Blocks } from '../js/constants.js';
import { flatWorld } from './harness.mjs';

const R = STICK_RADIUS;

function montar() {
  const { world, floor } = flatWorld(40, 48);
  const player = new Player(world, { x: 20.5, y: floor, z: 20.5 });
  const input = new Input({});   // sem canvas de verdade: nada aqui pede pointer lock
  return { world, floor, player, input };
}

/** Anda `frames` quadros de 1/60 e devolve o quanto se deslocou no plano. */
function andar(player, input, frames = 60) {
  const p0 = { x: player.pos.x, z: player.pos.z };
  for (let f = 0; f < frames; f++) player.update(1 / 60, input);
  return Math.hypot(player.pos.x - p0.x, player.pos.z - p0.z);
}

test('dedo pousado no meio do manche não anda', () => {
  const v = stickVector(3, -4);
  assertEqual(v.forward, 0, 'zona morta deixou passar movimento');
  assertEqual(v.strafe, 0, 'zona morta deixou passar movimento lateral');
});

test('empurrar o manche para cima é andar para a frente', () => {
  const v = stickVector(0, -R);
  assert(v.forward > 0.99, `para cima devia ser frente cheia, veio ${v.forward}`);
  assertEqual(v.strafe, 0, 'para cima não anda de lado');
});

test('manche até o fim corre; meio empurrão, não', () => {
  assert(stickVector(0, -R).run, 'empurrado até o fim devia correr');
  assert(!stickVector(0, -R / 2).run, 'meio empurrão não é corrida');
});

test('empurrar além da borda não passa de força cheia', () => {
  const v = stickVector(0, -R * 3);
  assert(Math.hypot(v.forward, v.strafe) <= 1.0001, 'manche passou de 1');
  assert(Math.hypot(v.dx, v.dy) <= R + 0.001, 'botão do manche saiu do círculo');
});

test('sem pointer lock o toque põe o jogador no comando', () => {
  const { input } = montar();
  assert(!input.locked, 'não há pointer lock nenhum aqui');
  assert(!input.active, 'sem toque e sem lock, o jogo fica parado');
  input.touchActive = true;
  assert(input.active, 'o toque não assumiu o comando — é o bug do iPhone');
  assert(!input.locked, 'toque não é pointer lock e não deve fingir que é');
});

test('tecla virtual do botão de pular tira o jogador do chão', () => {
  const { player, input } = montar();
  input.touchActive = true;
  player.update(1 / 60, input);            // assenta os pés: pulo só sai do chão
  assert(player.onGround, 'o jogador de teste não chegou ao chão');
  const y0 = player.pos.y;
  input.setVirtualKey('Space', true);
  player.update(1 / 60, input);
  assert(player.pos.y > y0, 'o botão de pular não pulou');
});

test('pausar solta as teclas seguradas pelo dedo', () => {
  const { input } = montar();
  input.touchActive = true;
  input.setVirtualKey('Space', true);
  input.setStick(1, 0);
  input.touchActive = false;
  assert(!input.isDown('Space'), 'tecla ficou presa depois de pausar');
  assertEqual(input.stick, null, 'manche ficou empurrado depois de pausar');
});

test('arrastar o dedo vira olhada, como o mouse', () => {
  const { player, input } = montar();
  const yaw0 = player.yaw;
  input.addLook(120, 0);
  player.update(1 / 60, input);
  assert(player.yaw !== yaw0, 'arrastar não girou o olhar');
  const { dx, dy } = input.consumeMouseDelta();
  assertEqual(dx, 0, 'o arrasto não foi consumido');
  assertEqual(dy, 0, 'o arrasto não foi consumido');
});

test('manche anda para onde se olha, e meia força anda menos', () => {
  const a = montar();
  a.input.setStick(1, 0);
  const cheio = andar(a.player, a.input);
  assert(a.player.pos.z < 20.5 - 1, 'com yaw 0, a frente é -Z e o jogador não foi para lá');

  const b = montar();
  b.input.setStick(0.5, 0);
  const meio = andar(b.player, b.input);
  assert(meio > 0.1, 'meio empurrão não andou nada');
  assert(meio < cheio * 0.75, `meio empurrão devia andar bem menos: ${meio} vs ${cheio}`);
});

test('manche cheio na diagonal não anda mais rápido que na reta', () => {
  const a = montar();
  a.input.setStick(1, 0);
  const reta = andar(a.player, a.input);

  const b = montar();
  const v = stickVector(R, -R);           // dedo no canto: já sai limitado ao raio
  b.input.setStick(v.forward, v.strafe);
  const diagonal = andar(b.player, b.input);
  assert(Math.abs(diagonal - reta) < 0.05, `diagonal ${diagonal} vs reta ${reta}`);
});

test('clique virtual quebra bloco sem mouse nenhum', () => {
  const { world, floor, player, input } = montar();
  const interaction = new Interaction(world, player, { add: () => {} }, input);
  player.pitch = -Math.PI / 2;            // olhando para os próprios pés
  interaction.update();
  const alvo = interaction._target;
  assert(alvo, 'nem o chão foi mirado');
  input.emitMouseButton(0);               // é isto que o toque na tela dispara
  assertEqual(world.getBlock(alvo.block.x, alvo.block.y, alvo.block.z), Blocks.AIR,
    'o toque não quebrou o bloco mirado');
  assert(floor > 0, 'mundo de teste degenerado');
});

test('tocar no slot escolhe o bloco como as teclas 1–9', () => {
  const { world, player, input } = montar();
  const interaction = new Interaction(world, player, { add: () => {} }, input);
  interaction.selectBlock(Blocks.STONE);
  assertEqual(interaction.selectedBlock, Blocks.STONE, 'o toque no hotbar não trocou o bloco');
  input.emitKeyPress('Digit7');
  assertEqual(interaction.selectedBlock, Blocks.WATER, 'a tecla virtual não trocou o bloco');
});

test('sem navegador, nada se declara tela de toque', () => {
  assertEqual(isTouchDevice(), false, 'em Node não existe dedo');
});
