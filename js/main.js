import { WORLD_SEED } from './constants.js';
import {
  openStorage, loadAllDiffs, flushDiffs, loadVillage, saveVillage, deleteWorld,
} from './world/storage.js';
import { World } from './world/world.js';
import { createScene, ChunkRenderer } from './render/renderer.js';
import { createAtlas } from './render/atlas.js';
import { Sky } from './render/sky.js';
import { Weather } from './render/weather.js';
import { Input } from './player/input.js';
import { TouchControls, isTouchDevice } from './player/touch.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { View, MODE_NAMES } from './player/view.js';
import { BotManager } from './bots/botManager.js';

async function boot() {
  // O jogo tem de rodar mesmo sem IndexedDB. No Safari em navegação privada (e
  // às vezes num iPhone com pouco espaço) abrir o banco falha, e um throw aqui
  // trocava o jogo inteiro pela tela de erro: perder o save é ruim, não poder
  // jogar é pior. Sem banco, `flushDiffs` e `saveVillage` já são no-op.
  let salvos = { blocks: new Map(), owners: new Map() };
  let aldeiaSalva = null;
  let semSave = false;
  try {
    await openStorage();
    salvos = await loadAllDiffs();
    aldeiaSalva = await loadVillage();
  } catch (err) {
    console.error('sem persistência neste navegador:', err);
    semSave = true;
  }

  const world = new World(WORLD_SEED, salvos.blocks, salvos.owners);

  const canvas = document.getElementById('game');
  const { renderer, scene, camera, sun, ambient } = createScene(canvas);
  const sky = new Sky(scene, sun, ambient);
  const weather = new Weather(scene);
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
  const bots = new BotManager(scene, world, 3, aldeiaSalva);
  // Mudança de tempo vira recado: sem aviso, começar a nevar é indistinguível
  // de um defeito de render.
  weather.onChange = (tipo) => {
    interaction.say(tipo === 'limpo' ? 'o tempo abriu' : `começou a ${tipo === 'chuva' ? 'chover' : 'nevar'}`);
  };

  // A aldeia vai para o disco quando uma obra fica pronta — poucas vezes por
  // sessão. Assim, ao voltar, os bots sabem o que já existe e levantam só o que
  // falta, em vez de recomeçar as seis por cima das casas de ontem.
  bots.village.onChange = () => {
    saveVillage(bots.village.serialize()).catch((err) => console.error('saveVillage:', err));
  };

  // Toque no slot escolhe o bloco. É o único caminho no celular (não há teclas
  // 1–9) e não atrapalha no desktop: com o mouse preso, o hotbar não recebe
  // evento nenhum.
  for (const slot of document.querySelectorAll('#hotbar .slot')) {
    slot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      interaction.selectBlock(Number(slot.dataset.block));
    });
  }

  const overlay = document.getElementById('overlay');

  // Duas formas de estar no comando: pointer lock (mouse) ou dedo. No iPhone só
  // existe a segunda — `requestPointerLock` lá não faz nada e nem sempre avisa,
  // então nem se pede: o toque no overlay já começa o jogo.
  const toque = isTouchDevice();
  if (toque) document.body.classList.add('toque');

  // Navegador sem pointer lock nenhum também entra pelo caminho do toque: seja
  // qual for o motivo de não haver lock, começar o jogo é melhor que ficar preso
  // na tela inicial — que é o defeito que se está consertando.
  const semLock = toque || typeof canvas.requestPointerLock !== 'function';

  let touchControls = null;
  // Um erro montando os controles de toque não pode derrubar o boot: sem este
  // try, uma exceção aqui levaria o jogo inteiro para a tela de erro e o
  // sintoma voltaria a ser "não passa da tela inicial".
  if (toque) {
    try {
      touchControls = new TouchControls(input, { onMenu: () => pausar() });
    } catch (err) {
      console.error('controles de toque:', err);
    }
  }

  function jogar() {
    // O recado do save só cabe agora: dito no boot, ele nasce atrás do overlay.
    if (semSave) {
      semSave = false;
      interaction.say('este navegador não guarda o mundo — nada será salvo');
    }
    if (semLock) {
      input.touchActive = true;
      if (toque) document.body.classList.add('jogando');
      overlay.classList.add('hidden');
      return;
    }
    // Chrome novo devolve Promise e rejeita quando o lock é negado (por exemplo
    // logo depois de um ESC); Safari devolve undefined. Sem o catch, a rejeição
    // vira erro não tratado no console e assusta quem for depurar.
    const pedido = canvas.requestPointerLock && canvas.requestPointerLock();
    if (pedido && typeof pedido.catch === 'function') pedido.catch(() => {});
  }

  // O ESC do celular é o botão ☰: sem teclado, sem isto não havia como voltar ao
  // menu (nem chegar ao botão de recomeçar o mundo).
  function pausar() {
    input.touchActive = false;
    if (touchControls) touchControls.reset();
    document.body.classList.remove('jogando');
    overlay.classList.remove('hidden');
  }

  // Três portas para a mesma sala, e `jogar()` é idempotente de propósito. No
  // iOS o `click` num div só vem depois de todo o gesto e às vezes não vem; o
  // `touchend` responde na hora, e o `pointerup` cobre quem não emite nem um nem
  // outro. Ficar preso na tela inicial é o defeito que se está consertando —
  // vale mais tentar três vezes que confiar num evento só.
  const abrir = (e) => {
    if (e.target && e.target.closest && e.target.closest('#reset')) return;
    if (e.cancelable && e.type === 'touchend') e.preventDefault(); // mata o clique fantasma
    jogar();
  };
  overlay.addEventListener('click', abrir);
  overlay.addEventListener('pointerup', abrir);
  overlay.addEventListener('touchend', abrir, { passive: false });

  // Recomeçar: apaga blocos e aldeia e recarrega. stopPropagation porque o
  // clique no overlay pede o pointer lock, e travar o mouse ao apagar o mundo
  // deixaria o jogador olhando para um mundo novo sem entender o que aconteceu.
  const resetBtn = document.getElementById('reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Apagar este mundo e começar outro do zero?')) return;
      resetBtn.disabled = true;
      resetBtn.textContent = 'apagando...';
      await deleteWorld().catch((err) => console.error('deleteWorld:', err));
      location.reload();
    });
  }
  document.addEventListener('pointerlockchange', () => {
    overlay.classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  // Gancho de QA: com #debug na URL, o jogo fica dirigível por código. O pointer
  // lock não é concedido a cliques automatizados, então sem isto não há como
  // testar quebrar/colocar bloco num navegador controlado.
  if (location.hash === '#debug') {
    window.__game = {
      world, player, input, interaction, view, chunkRenderer, bots,
      camera, scene, sky, weather,
    };
  }

  const fpsEl = document.getElementById('fps');
  const posEl = document.getElementById('pos');
  const aldeiaEl = document.getElementById('aldeia');
  const relogioEl = document.getElementById('relogio');
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

    if (input.active) {
      player.update(dt, input);
      interaction.update();
    }
    bots.update(dt, player.pos);
    chunkRenderer.update(player.pos);
    weather.update(dt, player.pos);
    sky.update(dt, player.pos, weather.darkness);
    view.update(dt, camera);

    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
      posEl.textContent =
        `x ${player.pos.x.toFixed(1)}  y ${player.pos.y.toFixed(1)}  z ${player.pos.z.toFixed(1)}`;

      if (relogioEl) {
        const faltam = Math.ceil(sky.untilNext / 60);
        relogioEl.textContent = `${sky.phase} · ${faltam} min`
          + (weather.kind === 'limpo' ? '' : ` · ${weather.kind}`);
      }

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
