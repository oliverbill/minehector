// Ponto de vista: o ciclo das três câmeras, o recuo da terceira pessoa parando
// antes da parede, e o boneco do jogador — que não é sorteado como o dos bots.
//
// O que se afirma aqui é geometria, que é o que dá para medir sem GPU: onde a
// câmera pára, para onde ela olha e se o boneco aparece. A cor do moletom não
// se testa; a existência das peças, sim.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { View, FIRST, THIRD_BACK, THIRD_FRONT } from '../js/player/view.js';
import { createAvatar, HEITOR } from '../js/bots/avatar.js';
import { Blocks, Owner } from '../js/constants.js';
import { flatWorld, createInput } from './harness.mjs';
import { Player } from '../js/player/player.js';

// Câmera de mentira com a mesma superfície que a View usa.
function fakeCamera() {
  const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  return { position: vec(), rotation: { ...vec(), order: '' } };
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
