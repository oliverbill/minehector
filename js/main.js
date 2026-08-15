import { WORLD_SEED } from './constants.js';
import { openStorage, loadAllDiffs, flushDiffs } from './world/storage.js';
import { World } from './world/world.js';
import { createScene, ChunkRenderer } from './render/renderer.js';
import { createAtlas } from './render/atlas.js';
import { Input } from './player/input.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { BotManager } from './bots/botManager.js';

async function boot() {
  await openStorage();
  const diffs = await loadAllDiffs();
  const world = new World(WORLD_SEED, diffs);

  const canvas = document.getElementById('game');
  const { renderer, scene, camera } = createScene(canvas);
  const atlas = createAtlas();
  const chunkRenderer = new ChunkRenderer(scene, world, atlas);

  const spawnY = world.surfaceHeight(8, 8) + 1;
  const player = new Player(world, { x: 8.5, y: spawnY, z: 8.5 });

  const input = new Input(canvas);
  const interaction = new Interaction(world, player, scene, input);
  const bots = new BotManager(scene, world, 3);

  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => {
    overlay.classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  const fpsEl = document.getElementById('fps');
  const posEl = document.getElementById('pos');
  let fpsAcc = 0, fpsFrames = 0;

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

    const eye = player.eyePos;
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(player.pitch, player.yaw, 0);

    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
      posEl.textContent =
        `x ${player.pos.x.toFixed(1)}  y ${player.pos.y.toFixed(1)}  z ${player.pos.z.toFixed(1)}`;
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
