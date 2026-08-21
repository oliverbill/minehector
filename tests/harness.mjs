// Monta um mundo de teste e liga Player + Interaction de verdade fora do browser.
// Regra desta suíte: nada de reimplementar a lógica do jogo aqui. Se um teste
// precisa saber a altura do olho, o alcance ou a força do pulo, ele descobre
// rodando o código real — assim mexer numa constante quebra o teste certo, e não
// deixa o teste passar medindo a cópia errada.

import { World } from '../js/world/world.js';
import { Blocks } from '../js/constants.js';
import { Player } from '../js/player/player.js';
import { Interaction } from '../js/player/interaction.js';

export { Blocks };

// DOM de mentira. Interaction só lê o toast e a mira (ambos opcionais); o avatar
// dos bots desenha em canvas 2D. O contexto falso guarda cada fillRect com a cor
// usada, para um teste poder afirmar o que foi pintado — sem isso a única coisa
// verificável seria "não explodiu".
export function stubDom() {
  if (globalThis.document) return;
  globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    // A Input de verdade se registra no documento; sem isto ela não pode ser
    // testada fora do browser, e é ela que recebe o que o toque injeta.
    addEventListener: () => {},
    createElement: (tag) => {
      if (tag !== 'canvas') return {};
      const ops = [];
      const ctx = {
        ops,
        fillStyle: '#000', font: '', textAlign: '', textBaseline: '',
        fillRect: (x, y, w, h) => ops.push({ x, y, w, h, color: ctx.fillStyle }),
        fillText: (text) => ops.push({ text }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      };
      return { width: 0, height: 0, ops, getContext: () => ctx };
    },
  };
}

/** Input falso: serve a Player (isDown/consumeMouseDelta) e a Interaction (callbacks). */
export function createInput() {
  const keys = new Set();
  const mouseCbs = [];
  const keyCbs = [];
  return {
    isDown: (code) => keys.has(code),
    consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    onMouseButton: (cb) => mouseCbs.push(cb),
    onKeyPress: (cb) => keyCbs.push(cb),
    hold: (code) => keys.add(code),
    release: (code) => keys.delete(code),
    press: (code) => { for (const cb of keyCbs) cb(code); },
    // Um clique é sempre precedido do update do frame, como no loop do main.js.
    click: (button) => { for (const cb of mouseCbs) cb(button); },
  };
}

/**
 * Platô plano: sólido até `groundTop`, ar acima. Devolve o mundo e o y dos pés
 * de quem estiver em pé nele.
 */
export function flatWorld(groundTop = 40, size = 32, topo = Blocks.STONE) {
  const world = new World(1337, new Map());
  for (let x = -1; x < size; x++) {
    for (let z = -1; z < size; z++) {
      for (let y = 0; y < 64; y++) {
        // `topo` existe por causa das ovelhas: elas só nascem sobre GRAMA, e um
        // platô de pedra é um mundo onde o rebanho nunca aparece — o teste
        // passaria medindo um rebanho vazio.
        const id = y < groundTop ? Blocks.STONE
          : y === groundTop ? topo
          : Blocks.AIR;
        world.setBlock(x, y, z, id);
      }
    }
  }
  world.dirty.clear();
  return { world, floor: groundTop + 1 };
}

/**
 * Jogador + interação ligados no mesmo input, como no boot do jogo.
 * `mobs` é o rebanho (SheepManager), quando o teste for de caça: a Interaction
 * do jogo recebe um, e sem ele a mira nunca disputa com ovelha nenhuma.
 */
export function scene(world, spawn, mobs = null) {
  const player = new Player(world, spawn);
  const input = createInput();
  const interaction = new Interaction(world, player, { add: () => {} }, input, mobs);
  const frame = () => interaction.update();          // o que o loop faz antes do clique
  return {
    player, input, interaction, frame,
    click: (button) => { frame(); input.click(button); },
  };
}

/** Altura da coluna em (x,z) acima do chão. */
export function columnHeight(world, x, z, floor) {
  let y = floor + 24;
  while (y >= floor && !world.isSolid(x, y, z)) y--;
  return y - floor + 1;
}

/** Coluna de `n` blocos em (x,z), a partir do chão; limpa o que houver acima. */
export function buildColumn(world, x, z, floor, n, id = Blocks.STONE) {
  for (let i = 0; i < 24; i++) world.setBlock(x, floor + i, z, i < n ? id : Blocks.AIR);
}

const deg = (d) => (d * Math.PI) / 180;

/**
 * Mira como o jogador mira: varre o pitch de cima para baixo até o destaque cair
 * no bloco pedido, e para no primeiro ângulo que serve (o mais alto na face).
 * `filter(hit, ctx)` afina a escolha — usado para exigir a metade de baixo.
 * Não escreve no mundo: só chama interaction.update().
 */
export function aimAt(ctx, block, filter) {
  const { player, interaction } = ctx;
  for (let d = 89; d >= -89; d -= 0.25) {
    player.pitch = deg(d);
    interaction.update();
    const hit = interaction._target;
    if (!hit) continue;
    if (hit.block.x !== block.x || hit.block.y !== block.y || hit.block.z !== block.z) continue;
    if (filter && !filter(hit, ctx)) continue;
    return hit;
  }
  return null;
}

/** Altura do ponto mirado dentro do bloco atingido: 0 = base da face, 1 = topo. */
export function hitHeightInBlock(ctx, hit) {
  const dir = ctx.interaction._dir;
  return ctx.player.eyePos.y + dir.y * hit.t - hit.block.y;
}

/** AABB do bloco [cell, cell+1)³ contra a AABB do jogador. */
export function cellHitsPlayer(player, cell) {
  const half = player.width / 2;
  return (
    cell.x + 1 > player.pos.x - half && cell.x < player.pos.x + half &&
    cell.y + 1 > player.pos.y && cell.y < player.pos.y + player.height &&
    cell.z + 1 > player.pos.z - half && cell.z < player.pos.z + half
  );
}

/**
 * Pula olhando para baixo e martela o botão direito durante o salto, como um
 * jogador faz para subir um pilar. Física real (Player.update) e o mesmo caminho
 * de clique do jogo — quem decide se cabe bloco é a Interaction, não o teste.
 * Devolve true se terminou o salto mais alto do que começou.
 */
export function jumpAndPlace(ctx, frames = 200) {
  const { player, input } = ctx;
  const dt = 1 / 60;
  const startY = player.pos.y;
  let jumped = false;
  for (let f = 0; f < frames; f++) {
    if (!jumped && player.onGround) { input.hold('Space'); jumped = true; }
    else input.release('Space');
    player.update(dt, input);
    if (jumped) ctx.click(2);
    if (jumped && player.onGround) return player.pos.y > startY;
  }
  return false;
}
