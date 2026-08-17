// BotManager (frente D): spawna os bots em círculo ao redor do spawn do
// jogador e, a cada frame, roda física + sync de mesh de todos; a decisão de
// IA é escalonada — cada bot pensa a cada ~0.3s, com offsets round-robin para
// não pensarem todos no mesmo frame.

import { moveEntity } from '../player/physics.js';
import { Bot } from './bot.js';
import { Village } from './village.js';

const ROSTER = [
  { name: 'Ana', color: 0xcc3333 },  // vermelho
  { name: 'Beto', color: 0x3366cc }, // azul
  { name: 'Caio', color: 0xe6cc33 }, // amarelo
];

const THINK_INTERVAL = 0.3;                 // s entre decisões de um bot
const SPAWN_CENTER = { x: 8.5, z: 8.5 };    // spawn do jogador (main.js)
const SPAWN_RADIUS = 10;                    // blocos
const FALLBACK_Y = 40;                      // se surfaceHeight devolver -1

export class BotManager {
  /** @param {object} savedVillage — aldeia salva (loadVillage), ou null. */
  constructor(scene, world, count, savedVillage = null) {
    this.world = world;
    this.bots = [];
    // A aldeia é compartilhada: é ela que impede dois bots de levantarem casas
    // uma dentro da outra, e é nela que ficam as portas que todos visitam.
    this.village = new Village(world, SPAWN_CENTER, Math.random, savedVillage);

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const x = SPAWN_CENTER.x + Math.cos(ang) * SPAWN_RADIUS;
      const z = SPAWN_CENTER.z + Math.sin(ang) * SPAWN_RADIUS;
      const surf = world.surfaceHeight(Math.floor(x), Math.floor(z));
      const y = surf === -1 ? FALLBACK_Y : surf + 1;

      const { name, color } = ROSTER[i % ROSTER.length];
      const bot = new Bot(name, color, { x, y, z }, Math.random, this.village);

      // Escalonamento round-robin: offsets espalhados dentro do intervalo.
      bot.thinkTimer = (THINK_INTERVAL * i) / count;
      bot.sinceThink = 0;

      this.bots.push(bot);
      scene.add(bot.mesh);
    }
  }

  update(dt, playerPos) {
    // Quem está de pé no mundo agora: obra nenhuma assenta bloco em cima deles.
    const ocupantes = [
      { pos: playerPos, width: 0.6, height: 1.8 },
      ...this.bots,
    ];

    for (const bot of this.bots) {
      bot.sinceThink += dt;
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.think(bot.sinceThink, playerPos);
        bot.sinceThink = 0;
        bot.thinkTimer += THINK_INTERVAL;
      }

      bot.steer(this.world, playerPos);
      moveEntity(this.world, bot, dt);
      bot.build(dt, ocupantes);
      bot.syncMesh(dt);
    }

    this.village.tick();   // persiste a aldeia quando uma obra fica pronta
  }
}
