// Controles de toque: o caminho que faz o jogo andar no iPhone e no iPad.
//
// O que dá para afirmar sem tela nem dedo é justamente o que quebrava: a conta
// do manche, o que o toque escreve no Input e o que o Player faz com isso. O
// arrasto e os botões são só DOM ligando um no outro — a regra que importa é que
// o jogo ande SEM pointer lock, porque no iPhone ele nunca vai existir.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { stickVector, isTouchDevice, STICK_RADIUS, TouchControls } from '../js/player/touch.js';
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

// --- o gesto inteiro, com uma tela de mentira ---------------------------------
//
// O que trava o iPad não está na conta do manche: está em quem solta o gesto. Um
// DOM de brinquedo — três elementos e uma lista de ouvintes — basta para pôr
// dois dedos na tela, levantar um de cada vez e conferir que ninguém fica preso.

function novoElemento(action) {
  const ouvintes = new Map();
  const classes = new Set();
  return {
    dataset: action ? { action } : {},
    style: {},
    classes,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    addEventListener(tipo, fn) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
      ouvintes.get(tipo).push(fn);
    },
    emitir(tipo, ev) { for (const fn of ouvintes.get(tipo) || []) fn(ev); },
  };
}

const dedo = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });

/** Monta TouchControls sobre um DOM falso e devolve o controle remoto da tela. */
function montarToque() {
  const { input } = montar();
  input.touchActive = true;

  const zonas = {
    touch: novoElemento(),
    'stick-zone': novoElemento(),
    'look-zone': novoElemento(),
    'stick-base': novoElemento(),
    'stick-knob': novoElemento(),
  };
  const botoes = ['pular', 'quebrar', 'colocar', 'visao', 'menu'].map(novoElemento);
  zonas.touch.querySelectorAll = () => botoes;

  const janela = novoElemento();
  const docReal = globalThis.document;
  const winReal = globalThis.window;
  globalThis.document = { getElementById: (id) => zonas[id] || null };
  globalThis.window = janela;
  let controls;
  try {
    controls = new TouchControls(input);
  } finally {
    globalThis.document = docReal;
    globalThis.window = winReal;
  }

  const ev = (tipo, changed, restantes) => ({
    type: tipo,
    changedTouches: changed,
    touches: restantes,
    preventDefault: () => {},
  });

  return {
    input,
    controls,
    botao: (acao) => botoes.find((b) => b.dataset.action === acao),
    // `restantes` é o que sobra na tela — é dele que sai a rede de segurança.
    pousa: (zona, t, restantes) => zonas[zona].emitir('touchstart', ev('touchstart', [t], restantes || [t])),
    arrasta: (t, restantes) => janela.emitir('touchmove', ev('touchmove', [t], restantes || [t])),
    levanta: (t, restantes = []) => janela.emitir('touchend', ev('touchend', [t], restantes)),
    aperta: (acao, pointerId) => {
      const b = botoes.find((x) => x.dataset.action === acao);
      b.emitir('pointerdown', { pointerId, preventDefault: () => {} });
    },
    largaPonteiro: (pointerId) => janela.emitir('pointerup', { pointerId }),
  };
}

test('empurrar o manche anda, e levantar o dedo pára', () => {
  const t = montarToque();
  t.pousa('stick-zone', dedo(1, 200, 500));
  t.arrasta(dedo(1, 200, 500 - STICK_RADIUS));
  assert(t.input.stick && t.input.stick.forward > 0.9, 'o manche não fez andar para a frente');
  t.levanta(dedo(1, 200, 500 - STICK_RADIUS));
  assertEqual(t.input.stick, null, 'o dedo saiu da tela e o jogador continuou andando');
});

test('levantar o dedo do olhar não solta o manche do outro dedo', () => {
  const t = montarToque();
  const olhar = dedo(1, 700, 400);
  const manche = dedo(2, 200, 500);
  t.pousa('look-zone', olhar, [olhar]);
  t.pousa('stick-zone', manche, [olhar, manche]);
  t.arrasta(dedo(2, 200, 500 - STICK_RADIUS), [olhar, manche]);
  assert(t.input.stick.forward > 0.9, 'o manche não pegou');

  t.levanta(olhar, [manche]);                 // o dedo do olhar sai; o do manche fica
  assert(t.input.stick && t.input.stick.forward > 0.9, 'levantar um dedo largou o manche do outro');

  t.levanta(manche, []);
  assertEqual(t.input.stick, null, 'o manche não foi solto quando o seu dedo saiu');
});

// Este é o defeito do iPad: com dois dedos, o fim do gesto chegava com a
// identidade trocada, o manche nunca era solto e o zona ficava reservada para um
// dedo que não existia mais — jogador andando para sempre, controle travado.
test('fim de gesto com identidade trocada não deixa o jogador andando', () => {
  const t = montarToque();
  t.pousa('stick-zone', dedo(2, 200, 500));
  t.arrasta(dedo(2, 200, 500 - STICK_RADIUS));
  assert(t.input.stick.forward > 0.9, 'o manche não pegou');

  t.levanta(dedo(99, 200, 400), []);          // identificador que nunca desceu
  assertEqual(t.input.stick, null, 'ficou andando sozinho: é o travamento do iPad');
  assert(!t.input.isDown('ShiftLeft'), 'ficou correndo sozinho');

  t.pousa('stick-zone', dedo(3, 300, 500));   // e a zona aceita dedo novo
  t.arrasta(dedo(3, 300, 500 - STICK_RADIUS));
  assert(t.input.stick && t.input.stick.forward > 0.9, 'o manche ficou travado para sempre');
});

test('toque curto na metade direita quebra; arrasto longo só olha', () => {
  const t = montarToque();
  let cliques = 0;
  t.input.onMouseButton((b) => { if (b === 0) cliques++; });

  t.pousa('look-zone', dedo(1, 700, 400));
  t.levanta(dedo(1, 700, 400));
  assertEqual(cliques, 1, 'o toque curto não quebrou o bloco mirado');

  t.pousa('look-zone', dedo(2, 700, 400));
  t.arrasta(dedo(2, 500, 400));
  t.levanta(dedo(2, 500, 400));
  assertEqual(cliques, 1, 'arrastar para olhar não devia quebrar bloco');
  const { dx } = t.input.consumeMouseDelta();
  assert(dx < 0, 'o arrasto não virou olhada');
});

test('largar o dedo do manche não solta o botão de pular', () => {
  const t = montarToque();
  t.pousa('stick-zone', dedo(1, 200, 500));
  t.aperta('pular', 7);
  assert(t.input.isDown('Space'), 'o botão de pular não segurou a tecla');

  t.largaPonteiro(1);                         // o ponteiro do manche, não o do botão
  assert(t.input.isDown('Space'), 'levantar o dedo do manche largou o pulo junto');

  t.largaPonteiro(7);
  assert(!t.input.isDown('Space'), 'o pulo ficou preso depois de soltar o botão');
});

test('sem dedo nenhum na tela, nada continua apertado', () => {
  const t = montarToque();
  t.aperta('pular', 3);
  t.pousa('stick-zone', dedo(1, 200, 500));
  t.arrasta(dedo(1, 200, 500 - STICK_RADIUS));
  assert(t.input.isDown('Space') && t.input.stick, 'o cenário não montou');

  t.levanta(dedo(1, 200, 400), []);           // último dedo fora: a rede fecha tudo
  assertEqual(t.input.stick, null, 'manche preso com a tela vazia');
  assert(!t.input.isDown('Space'), 'pulo preso com a tela vazia');
});
