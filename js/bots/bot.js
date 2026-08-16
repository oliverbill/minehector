// Bot (frente D): entidade com física compartilhada (moveEntity), corpo em
// caixas coloridas + sprite de nome, e FSM idle -> wander -> follow.
//
// A FSM vive em BotBrain, uma classe pura (sem THREE, sem DOM) para ser
// testável em Node com um rng injetado. A classe Bot embrulha o cérebro com
// o corpo visual e o steering.

import { createAvatar } from './avatar.js';

// ---------------------------------------------------------------------------
// Parâmetros da FSM / movimento (contrato do ARCHITECTURE.md)
// ---------------------------------------------------------------------------
export const IDLE_MIN = 2;        // s
export const IDLE_MAX = 4;        // s
export const WANDER_RANGE = 12;   // blocos (máximo horizontal do alvo)
export const WANDER_TIMEOUT = 6;  // s até desistir do alvo
export const WANDER_ARRIVE = 0.8; // blocos: chegou ao alvo
export const FOLLOW_START = 10;   // blocos: jogador perto o bastante p/ seguir
export const FOLLOW_CHANCE = 0.3; // chance de seguir ao decidir novo estado
export const FOLLOW_STOP = 2;     // blocos: para de avançar
export const FOLLOW_LOSE = 14;    // blocos: abandona o follow
export const WALK_SPEED = 3.5;    // blocos/s
export const JUMP_SPEED = 8.5;    // blocos/s (vel.y ao pular)
export const BUILD_CHANCE = 0.35; // chance de começar uma obra, se houver lugar
export const VISIT_CHANCE = 0.35; // chance de ir visitar uma construção pronta
export const VISIT_RANGE = 30;    // blocos: até onde procura uma porta
export const VISIT_ARRIVE = 1.0;  // blocos: chegou à porta / ao meio da casa
export const BUILD_RANGE = 3.0;   // blocos: perto o bastante do sítio p/ assentar

// ---------------------------------------------------------------------------
// FSM pura — sem THREE, sem world, sem DOM.
// ---------------------------------------------------------------------------
export class BotBrain {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.state = 'idle';
    this.timer = IDLE_MIN + rng() * (IDLE_MAX - IDLE_MIN);
    this.target = null; // { x, z } quando em wander
  }

  // Chamada a cada tick de pensamento (~0.3s), com o tempo decorrido desde o
  // último tick. ctx = { x, z, playerDist, canBuild, building, door } — posição
  // do bot, distância horizontal até o jogador, se há lugar para uma obra nova,
  // se a obra dele ainda corre, e a porta mais próxima. Retorna o estado.
  update(elapsed, ctx) {
    this.timer -= elapsed;

    if (this.state === 'idle') {
      if (this.timer <= 0) this._decideNext(ctx);
    } else if (this.state === 'wander') {
      const dx = this.target.x - ctx.x;
      const dz = this.target.z - ctx.z;
      const arrived = Math.hypot(dx, dz) < WANDER_ARRIVE;
      if (arrived || this.timer <= 0) this._toIdle();
    } else if (this.state === 'follow') {
      if (ctx.playerDist > FOLLOW_LOSE) this._toIdle();
    } else if (this.state === 'build') {
      // Quem encerra a obra é o corpo (o Bot), que sabe se ainda há bloco na
      // fila; o cérebro só desiste se ela nunca começou.
      if (!ctx.building) this._toIdle();
    } else if (this.state === 'visit') {
      const d = Math.hypot(this.target.x - ctx.x, this.target.z - ctx.z);
      if (d < VISIT_ARRIVE) {
        // Chegou à soleira: entra. Parar na porta é ficar de fora.
        if (this.visitStage === 'door' && this.target.inside) {
          this.visitStage = 'inside';
          this.target = { x: this.target.inside.x, z: this.target.inside.z, inside: null };
          this.timer = WANDER_TIMEOUT;
        } else {
          this._toIdle();
        }
      } else if (this.timer <= 0) {
        this._toIdle();
      }
    }
    return this.state;
  }

  _toIdle() {
    this.state = 'idle';
    this.timer = IDLE_MIN + this.rng() * (IDLE_MAX - IDLE_MIN);
    this.target = null;
    this.visitStage = null;
  }

  // Decisão de novo estado (ao fim do idle): construir, visitar uma construção
  // pronta, seguir o jogador ou vaguear. Construir vem primeiro porque é o que
  // muda o mundo; visitar dá vida às casas que já existem.
  _decideNext(ctx) {
    if (ctx.canBuild && this.rng() < BUILD_CHANCE) {
      this.state = 'build';
      this.timer = 0;
      this.target = null;
      return;
    }
    if (ctx.door && this.rng() < VISIT_CHANCE) {
      this.state = 'visit';
      this.visitStage = 'door';
      this.target = { x: ctx.door.x, z: ctx.door.z, inside: ctx.door.inside || null };
      this.timer = WANDER_TIMEOUT * 2;
      return;
    }
    if (ctx.playerDist < FOLLOW_START && this.rng() < FOLLOW_CHANCE) {
      this.state = 'follow';
      this.timer = 0;
      this.target = null;
      return;
    }
    const ang = this.rng() * Math.PI * 2;
    const dist = 2 + this.rng() * (WANDER_RANGE - 2);
    this.target = {
      x: ctx.x + Math.cos(ang) * dist,
      z: ctx.z + Math.sin(ang) * dist,
    };
    this.state = 'wander';
    this.timer = WANDER_TIMEOUT;
  }
}

// ---------------------------------------------------------------------------
// Bot: entidade física + cérebro + mesh
// ---------------------------------------------------------------------------
export class Bot {
  constructor(name, color, spawnPos, rng = Math.random, village = null) {
    this.name = name;
    this.village = village;
    this.job = null;      // obra em andamento (village.js)

    // Contrato de entity do moveEntity (physics.js): pos = centro da base.
    this.pos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = 0.6;
    this.height = 1.8;
    this.onGround = false;

    this.brain = new BotBrain(rng);
    this.yaw = 0;
    this.targetYaw = 0;

    this.avatar = createAvatar(name, color);
    this.mesh = this.avatar.group;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  // Tick de IA (~0.3s): alimenta a FSM com a distância ao jogador, se há lugar
  // para uma obra e qual a porta mais próxima.
  think(elapsed, playerPos) {
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const v = this.village;
    const antes = this.brain.state;

    this.brain.update(elapsed, {
      x: this.pos.x,
      z: this.pos.z,
      playerDist: Math.hypot(dx, dz),
      canBuild: !!v && !v.full && !this.job,
      building: !!this.job,
      door: v ? v.nearestDoor(this.pos.x, this.pos.z, VISIT_RANGE) : null,
    });

    // Entrou em 'build' agora: procura o terreno. Sem sítio, volta a vaguear —
    // terreno quebrado é comum e insistir travaria o bot no lugar.
    if (this.brain.state === 'build' && antes !== 'build' && !this.job && v) {
      this.job = v.planNear(this.pos.x, this.pos.z);
      if (!this.job) this.brain._toIdle();
    }
  }

  // Assentamento: só trabalha depois de chegar ao pé da obra. Um bot que
  // constrói de longe parece telecinese.
  build(dt, occupants) {
    if (!this.job) return;
    const p = this.job.standPoint;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > BUILD_RANGE) return;
    if (this.job.step(dt, occupants)) this.job = null;
  }

  // Steering por frame: seta vel.x/vel.z na direção do alvo do estado atual
  // e pula se estiver bloqueado à frente com espaço livre acima.
  steer(world, playerPos) {
    let tx = null;
    let tz = null;
    const b = this.brain;

    if ((b.state === 'wander' || b.state === 'visit') && b.target) {
      tx = b.target.x;
      tz = b.target.z;
    } else if (b.state === 'build' && this.job) {
      const p = this.job.standPoint;
      // Chegou ao pé da obra: para e trabalha.
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > BUILD_RANGE * 0.7) {
        tx = p.x;
        tz = p.z;
      }
    } else if (b.state === 'follow') {
      const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      if (d > FOLLOW_STOP) {
        tx = playerPos.x;
        tz = playerPos.z;
      }
    }

    if (tx === null) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }

    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }
    const nx = dx / len;
    const nz = dz / len;
    this.vel.x = nx * WALK_SPEED;
    this.vel.z = nz * WALK_SPEED;

    // Pulo: bloco sólido na altura dos pés logo à frente, com 2 células
    // livres acima (o bot tem 1.8 de altura).
    if (this.onGround) {
      const reach = this.width / 2 + 0.35;
      const bx = Math.floor(this.pos.x + nx * reach);
      const bz = Math.floor(this.pos.z + nz * reach);
      const fy = Math.floor(this.pos.y + 0.01);
      if (
        world.isSolid(bx, fy, bz) &&
        !world.isSolid(bx, fy + 1, bz) &&
        !world.isSolid(bx, fy + 2, bz)
      ) {
        this.vel.y = JUMP_SPEED;
      }
    }
  }

  // Sincroniza o mesh com a física, suaviza a rotação Y na direção do movimento
  // (interpolação pelo menor arco) e anima o boneco com a velocidade real — a
  // passada tem de casar com o chão, senão o bot patina.
  syncMesh(dt) {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    const sx = this.vel.x;
    const sz = this.vel.z;
    const speed = Math.hypot(sx, sz);
    if (sx * sx + sz * sz > 1e-4) {
      this.targetYaw = Math.atan2(sx, sz);
    }
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 8);
    this.mesh.rotation.y = this.yaw;

    this.avatar.animate(dt, speed, this.onGround);
  }
}
