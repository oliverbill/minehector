// Bot (frente D): entidade com física compartilhada (moveEntity), corpo em
// caixas coloridas + sprite de nome, e FSM idle -> wander -> follow.
//
// A FSM vive em BotBrain, uma classe pura (sem THREE, sem DOM) para ser
// testável em Node com um rng injetado. A classe Bot embrulha o cérebro com
// o corpo visual e o steering.

import * as THREE from 'three';

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
  // último tick. ctx = { x, z, playerDist } (posição do bot e distância
  // horizontal até o jogador). Retorna o estado corrente.
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
    }
    return this.state;
  }

  _toIdle() {
    this.state = 'idle';
    this.timer = IDLE_MIN + this.rng() * (IDLE_MAX - IDLE_MIN);
    this.target = null;
  }

  // Decisão de novo estado (ao fim do idle): 30% de follow se o jogador está
  // a menos de 10 blocos; senão, wander para um ponto aleatório até 12 blocos.
  _decideNext(ctx) {
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
// Corpo visual
// ---------------------------------------------------------------------------
function makeNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.2;
  return sprite;
}

function makeBody(color, name) {
  const group = new THREE.Group();

  const bodyColor = new THREE.Color(color);
  const headColor = bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.35);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1.05, 0.3),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  body.position.y = 0.525; // origem do group na base (pés)
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshLambertMaterial({ color: headColor })
  );
  head.position.y = 1.3;
  group.add(head);

  group.add(makeNameSprite(name));
  return group;
}

// ---------------------------------------------------------------------------
// Bot: entidade física + cérebro + mesh
// ---------------------------------------------------------------------------
export class Bot {
  constructor(name, color, spawnPos, rng = Math.random) {
    this.name = name;

    // Contrato de entity do moveEntity (physics.js): pos = centro da base.
    this.pos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = 0.6;
    this.height = 1.8;
    this.onGround = false;

    this.brain = new BotBrain(rng);
    this.yaw = 0;
    this.targetYaw = 0;

    this.mesh = makeBody(color, name);
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  // Tick de IA (~0.3s): alimenta a FSM com a distância horizontal ao jogador.
  think(elapsed, playerPos) {
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    this.brain.update(elapsed, {
      x: this.pos.x,
      z: this.pos.z,
      playerDist: Math.hypot(dx, dz),
    });
  }

  // Steering por frame: seta vel.x/vel.z na direção do alvo do estado atual
  // e pula se estiver bloqueado à frente com espaço livre acima.
  steer(world, playerPos) {
    let tx = null;
    let tz = null;
    const b = this.brain;

    if (b.state === 'wander' && b.target) {
      tx = b.target.x;
      tz = b.target.z;
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

  // Sincroniza o mesh com a física e suaviza a rotação Y na direção do
  // movimento (interpolação pelo menor arco).
  syncMesh(dt) {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    const sx = this.vel.x;
    const sz = this.vel.z;
    if (sx * sx + sz * sz > 1e-4) {
      this.targetYaw = Math.atan2(sx, sz);
    }
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 8);
    this.mesh.rotation.y = this.yaw;
  }
}
