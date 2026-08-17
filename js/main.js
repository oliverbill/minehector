import { WORLD_SEED } from './constants.js';
import { openStorage, loadAllDiffs, flushDiffs } from './world/storage.js';
import { World } from './world/world.js';
import { createScene, ChunkRenderer } from './render/renderer.js';
import { createAtlas } from './render/atlas.js';
import { Input } from './player/input.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { View, MODE_NAMES } from './player/view.js';
import { BotManager } from './bots/botManager.js';

async function boot() {
  await openStorage();
  const { blocks, owners } = await loadAllDiffs();
  const world = new World(WORLD_SEED, blocks, owners);

  const canvas = document.getElementById('game');
  const { renderer, scene, camera } = createScene(canvas);
  const atlas = createAtlas();
  const chunkRenderer = new ChunkRenderer(scene, world, atlas);

  for (const slot of document.querySelectorAll('#hotbar .slot')) {
    const sw = slot.querySelector('.sw');
    if (sw) sw.style.backgroundImage = `url(${atlas.swatch(Number(slot.dataset.block))})`;
  }

  const spawnY = world.surfaceHeight(8, 8) + 1;
  const player = new Player(world, { x: 8.5, y: spawnY, z: 8.5 });

  const input = new Input(canvas);
  const interaction = new Interaction(world, player, scene, input);
  const view = new View(world, player, scene, input, (mode) => interaction.say(MODE_NAMES[mode]));
  const bots = new BotManager(scene, world, 3);

  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => {
    overlay.classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  // Gancho de QA: com #debug na URL, o jogo fica dirigível por código. O pointer
  // lock não é concedido a cliques automatizados, então sem isto não há como
  // testar quebrar/colocar bloco num navegador controlado.
  if (location.hash === '#debug') {
    window.__game = { world, player, input, interaction, view, chunkRenderer, bots, camera, scene };
  }

  const fpsEl = document.getElementById('fps');
  const posEl = document.getElementById('pos');
  const aldeiaEl = document.getElementById('aldeia');
  let fpsAcc = 0, fpsFrames = 0;

  // Seta para a construção mais próxima, relativa a para onde você está olhando.
  // Cinco casas a quinze blocos dentro de uma floresta são invisíveis do spawn.
  const SETAS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  function seta(alvoX, alvoZ) {
    // Ângulo do alvo menos o ângulo do olhar. Yaw 0 é olhar para -Z, e é por
    // isso que a conta usa (-dz) como "para a frente".
    const ang = Math.atan2(alvoX - player.pos.x, -(alvoZ - player.pos.z)) - player.yaw;
    const i = Math.round(((ang % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 4)) % 8;
    return SETAS[i];
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (input.locked) {
      player.update(dt, input);
      interaction.update();
    }
    bots.update(dt, player.pos);
    chunkRenderer.update(player.pos);
    view.update(dt, camera);

    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
      posEl.textContent =
        `x ${player.pos.x.toFixed(1)}  y ${player.pos.y.toFixed(1)}  z ${player.pos.z.toFixed(1)}`;

      if (aldeiaEl) {
        const perto = bots.village.nearest(player.pos.x, player.pos.z);
        const faltam = bots.village.pending.length;
        aldeiaEl.textContent = perto
          ? `${seta(perto.origin.x, perto.origin.z)} ${perto.kind}`
            + ` a ${Math.round(perto.dist)}m${perto.emObra ? ' (em obra)' : ''}`
            + (faltam ? ` · faltam ${faltam}` : ' · aldeia completa')
          : 'os bots ainda estão escolhendo onde construir';
      }
      fpsAcc = 0; fpsFrames = 0;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('pagehide', () => { flushDiffs(); });
}

boot().catch((err) => {
  console.error(err);
  const panel = document.querySelector('#overlay .panel');
  if (panel) panel.innerHTML = `<h1>Erro</h1><p>${err.message}</p>`;
});
