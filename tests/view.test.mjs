// Ponto de vista: o ciclo das três câmeras, o recuo da terceira pessoa parando
// antes da parede, e o boneco do jogador — que não é sorteado como o dos bots.
//
// O que se afirma aqui é geometria, que é o que dá para medir sem GPU: onde a
// câmera pára, para onde ela olha e se o boneco aparece. A cor do moletom não
// se testa; a existência das peças, sim.

import * as THREE from 'three';
import { test, assert, assertEqual } from './tiny-test.mjs';
import { createHandPickaxe, createPickaxe } from '../js/render/pickaxe.js';
import { View, FIRST, THIRD_BACK, THIRD_FRONT } from '../js/player/view.js';
import { createAvatar, HEITOR } from '../js/bots/avatar.js';
import { Blocks, Owner } from '../js/constants.js';
import { flatWorld, createInput } from './harness.mjs';
import { Player } from '../js/player/player.js';

// Câmera de mentira com a mesma superfície que a View usa. `add` entrou junto
// com a picareta de primeira pessoa: ela é pendurada NA câmera, e uma câmera de
// teste sem `add` não é a mesma superfície que o jogo usa.
function fakeCamera() {
  const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  return {
    position: vec(),
    rotation: { ...vec(), order: '' },
    children: [],
    add(o) { this.children.push(o); },
  };
}

function montar(groundTop = 40) {
  const { world, floor } = flatWorld(groundTop, 48);
  const player = new Player(world, { x: 20.5, y: floor, z: 20.5 });
  const input = createInput();
  const view = new View(world, player, { add: () => {} }, input);
  return { world, floor, player, input, view, camera: fakeCamera() };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('V passeia pelas três câmeras e volta ao começo', () => {
  const { view, input } = montar();
  assertEqual(view.mode, FIRST, 'o jogo não começa em primeira pessoa');
  input.press('KeyV');
  assertEqual(view.mode, THIRD_BACK, 'V não levou para a terceira pessoa');
  input.press('KeyV');
  assertEqual(view.mode, THIRD_FRONT, 'V não levou para a terceira de frente');
  input.press('KeyV');
  assertEqual(view.mode, FIRST, 'V não fechou o ciclo');
});

test('em primeira pessoa a câmera fica no olho e o boneco some', () => {
  const { view, player, camera } = montar();
  view.update(1 / 60, camera);
  const eye = player.eyePos;
  assert(dist(camera.position, eye) < 1e-9, 'a câmera saiu do olho');
  assertEqual(view.avatar.group.visible, false, 'o boneco aparece na frente do próprio dono');
});

test('em terceira pessoa a câmera recua no contrário do olhar e o boneco aparece', () => {
  const { view, player, camera } = montar();
  view.cycle();
  view.update(1 / 60, camera);

  const eye = player.eyePos;
  assert(view.avatar.group.visible, 'o boneco não apareceu');
  assert(dist(camera.position, eye) > 1, `a câmera mal saiu do lugar (${dist(camera.position, eye)})`);
  // Yaw 0 é olhar para -Z, então recuar é ir para +Z.
  assert(camera.position.z > eye.z, 'a câmera recuou para o lado errado');
  assertEqual(camera.rotation.y, player.yaw, 'a câmera de trás não olha para onde o jogador olha');
});

test('de frente, a câmera vai para o outro lado e se vira para o jogador', () => {
  const { view, player, camera } = montar();
  view.cycle();
  view.cycle();
  view.update(1 / 60, camera);

  const eye = player.eyePos;
  assert(camera.position.z < eye.z, 'a câmera de frente não foi para a frente do jogador');
  assertEqual(camera.rotation.y, player.yaw + Math.PI, 'a câmera de frente não olha de volta');
  assertEqual(camera.rotation.x, -player.pitch, 'o pitch não foi invertido junto');
});

test('a câmera de trás pára antes da parede em vez de atravessá-la', () => {
  const { world, floor, view, player, camera } = montar();

  // Parede colada nas costas do jogador (que olha para -Z, então as costas são +Z).
  const zParede = Math.floor(player.pos.z) + 2;
  for (let x = 18; x <= 23; x++) {
    for (let y = floor; y < floor + 4; y++) world.setBlock(x, y, zParede, Blocks.STONE, Owner.PLAYER);
  }

  view.cycle();
  view.update(1 / 60, camera);

  assert(camera.position.z < zParede, `a câmera entrou na parede (z=${camera.position.z}, parede em ${zParede})`);
  assert(!world.isSolid(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)),
    'a câmera parou dentro de bloco sólido');
});

test('o boneco fica de pé onde o jogador está e vira com ele', () => {
  const { view, player, camera } = montar();
  view.cycle();
  player.yaw = Math.PI / 2;
  view.update(1 / 60, camera);

  const g = view.avatar.group;
  assertEqual(g.position.x, player.pos.x, 'x do boneco');
  assertEqual(g.position.y, player.pos.y, 'y do boneco (a origem é nos pés)');
  assertEqual(g.position.z, player.pos.z, 'z do boneco');
  // O rosto é a face +Z e o jogador com yaw 0 olha para -Z: meia volta de defasagem.
  assertEqual(g.rotation.y, player.yaw + Math.PI, 'o boneco não olha para onde o jogador olha');
});

test('o boneco do jogador é sempre o mesmo, e não tem nome flutuando', () => {
  const a = createAvatar('Heitor', 0x1c1c1f, HEITOR);
  const b = createAvatar('Heitor', 0x1c1c1f, HEITOR);
  assertEqual(a.group.children.filter((c) => c.type === 'Sprite').length, 0, 'sprite de nome no jogador');
  // Cabeça, tronco, 2 braços, 2 pernas e o capuz.
  assertEqual(a.group.children.length, 7, 'peças do boneco do jogador');
  assertEqual(b.group.children.length, a.group.children.length, 'dois Heitores diferentes');
  assert(HEITOR.glove && HEITOR.shorts && HEITOR.hoodie, 'o visual do Heitor perdeu luva, bermuda ou moletom');
});

test('a cabeça do jogador segue a mira em vez de olhar sozinha para os lados', () => {
  const a = createAvatar('Heitor', 0x1c1c1f, HEITOR);
  const cabeca = a.group.children.find((c) => c.type === 'Group');
  assert(cabeca, 'não achei o pivô da cabeça');

  a.animate(1 / 60, 0, true, 0.8);
  assertEqual(cabeca.rotation.y, 0, 'a cabeça continuou vagando com a mira dada');
  assert(cabeca.rotation.x < 0, 'olhar para cima não levantou a cabeça');

  // Sem pitch (o caso dos bots), a cabeça volta a se mexer sozinha.
  const bot = createAvatar('Ana', 0xcc3333);
  const cabecaBot = bot.group.children.find((c) => c.type === 'Group');
  for (let i = 0; i < 40; i++) bot.animate(1 / 60, 0, true);
  assert(cabecaBot.rotation.y !== 0, 'o bot virou estátua');
});

// --- a picareta ---------------------------------------------------------------
//
// Ela tem duas encarnações e as duas são a mesma promessa: você está com uma
// picareta na mão. Em primeira pessoa, pendurada na câmera; em terceira, na mão
// do boneco. O que se testa aqui é que nenhuma das duas aparece na hora errada
// — picareta flutuando no meio da tela em terceira pessoa é o defeito clássico.

/** A ferramenta pendurada no pivô do braço direito do boneco. */
const ferramentaDe = (a) => {
  const bracoD = a.group.children.find(
    (c) => c.type === 'Group' && c.position.x > 0 && c.position.y > 1,
  );
  return bracoD ? bracoD.children.find((c) => c.type === 'Group') : null;
};

test('a picareta de primeira pessoa pendura na câmera e some em terceira', () => {
  const { view, camera } = montar();
  view.update(1 / 60, camera);
  assert(camera.children.includes(view.mao.group), 'a picareta não foi pendurada na câmera');
  assertEqual(view.mao.group.visible, true, 'primeira pessoa sem picareta na tela');

  view.cycle();
  view.update(1 / 60, camera);
  assertEqual(view.mao.group.visible, false, 'a picareta ficou boiando na terceira pessoa');

  // Pendurada UMA vez: um `add` por frame encheria a câmera de picaretas.
  view.cycle(); view.cycle();
  view.update(1 / 60, camera);
  assertEqual(camera.children.filter((c) => c === view.mao.group).length, 1,
    'a picareta foi pendurada mais de uma vez');
});

test('a martelada da picareta segue o clique e volta ao repouso', () => {
  const { view, input, camera } = montar();
  const y = () => view.mao.group.position.y;
  view.update(1 / 60, camera);
  const repouso = y();

  input.click(0);                                   // é o clique que acende o golpe
  let baixou = false;
  for (let i = 0; i < 24; i++) {
    view.update(1 / 60, camera);
    if (y() < repouso - 0.02) baixou = true;
  }
  assert(baixou, 'a picareta não desceu nenhuma martelada depois do clique');

  for (let i = 0; i < 240; i++) view.update(1 / 60, camera);
  assert(Math.abs(y() - repouso) < 0.05, `parou fora do repouso, em ${y()}`);
});

test('a picareta do jogador não sai da mão; o martelo do bot só na obra', () => {
  const heitor = createAvatar('Heitor', 0x1c1c1f, HEITOR);
  const picareta = ferramentaDe(heitor);
  assert(picareta, 'o jogador não tem ferramenta na mão direita');
  assertEqual(picareta.visible, true, 'a picareta nasceu escondida');

  heitor.animate(1 / 60, 0, true, 0, false);
  assertEqual(picareta.visible, true, 'a picareta sumiu quando ele parou de bater');
  assertEqual(heitor.building, false, 'parado, o boneco se diz construindo');

  heitor.animate(1 / 60, 0, true, 0, true);
  assertEqual(picareta.visible, true, 'a picareta sumiu no golpe');
  assertEqual(heitor.building, true, 'batendo, o boneco não se diz construindo');

  // O bot continua com a regra antiga: ferramenta é sinal de obra em andamento.
  const bot = createAvatar('Ana', 0xcc3333);
  const martelo = ferramentaDe(bot);
  assertEqual(martelo.visible, false, 'bot com martelo na mão sem obra');
  bot.animate(1 / 60, 0, true, undefined, true);
  assertEqual(martelo.visible, true, 'bot em obra sem martelo');
});

test('a picareta de primeira pessoa nunca encosta no near plane', () => {
  // A câmera tem near = 0,1 (js/render/renderer.js). A picareta é filha dela, a
  // meio bloco do olho: se uma martelada a trouxer para dentro de 0,1, o canto
  // de baixo dela começa a ser COMIDO pelo recorte, e o defeito aparece só em
  // movimento — o tipo que não se acha lendo o código. Daí medir aqui.
  const NEAR = 0.1;
  const mao = createHandPickaxe();
  let maisPerto = Infinity;
  for (const batendo of [false, true, false]) {
    for (let i = 0; i < 300; i++) {
      mao.animate(1 / 60, batendo);
      mao.group.updateMatrixWorld(true);
      const caixa = new THREE.Box3().setFromObject(mao.group);
      maisPerto = Math.min(maisPerto, -caixa.max.z);   // -Z é para dentro da tela
      assert(Number.isFinite(caixa.max.z), 'a animação produziu NaN');
    }
  }
  assert(maisPerto > NEAR * 2, `a picareta chegou a ${maisPerto.toFixed(3)} do olho`);
});

test('a picareta cabe no canto sem tapar a tela', () => {
  // Metade da tela a 0,55 bloco num campo vertical de 75°: 0,42 de meia altura.
  // A ferramenta inteira tem de caber numa fração disso, senão volta a ser a
  // barra cinzenta que atravessava o canto inferior direito.
  const mao = createHandPickaxe();
  mao.animate(1 / 60, false);
  mao.group.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(mao.group);
  const larg = c.max.x - c.min.x;
  assert(larg < 0.45, `a picareta ficou com ${larg.toFixed(2)} de largura na tela`);
  assert(larg > 0.2, `a picareta encolheu demais: ${larg.toFixed(2)}`);
  assert(c.max.x > 0.15, 'a picareta saiu do canto direito e foi para o meio da tela');
  assert(c.min.y < -0.1, 'a picareta subiu para o meio da tela');
});

test('a picareta tem cabo, cabeça e as duas pontas', () => {
  // A silhueta é a única coisa que a ferramenta precisa entregar, e ela vem das
  // peças: sem as pontas, o que se vê é um martelo.
  const g = createPickaxe();
  g.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(g);
  const alt = caixa.max.y - caixa.min.y;
  const vao = caixa.max.x - caixa.min.x;
  assert(alt > 0.9 && alt < 1.05, `altura fora do esperado: ${alt.toFixed(3)}`);
  // A cabeça tem de ser bem mais estreita que o comprimento do cabo: cabeça
  // larga demais lê "marreta", e foi assim que ela nasceu.
  assert(vao < alt * 0.7, `cabeça larga demais para o cabo: ${vao.toFixed(3)} vs ${alt.toFixed(3)}`);
  assert(caixa.max.y > 0 && caixa.min.y < -0.5, 'a empunhadura não está entre a cabeça e o cabo');
  assertEqual(g.children.length, 4, 'peças da picareta: cabo, barra e as duas pontas');
});
