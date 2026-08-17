// Jogador em primeira pessoa. Movimento WASD relativo ao yaw, pulo, corrida.
// Convenção Three.js: rotation.order 'YXZ', yaw em torno de Y, olhar para -Z
// quando yaw = 0 — direção horizontal do olhar = (-sin(yaw), -cos(yaw)).
import { moveEntity, inLiquid, SWIM_UP } from './physics.js';

const WALK_SPEED = 4.3;   // blocos/s
const RUN_SPEED = 5.6;
const JUMP_SPEED = 8.5;
const EYE_HEIGHT = 1.62;
const MOUSE_SENS = 0.0025; // rad/px
const MAX_PITCH = (89 * Math.PI) / 180;

export class Player {
  constructor(world, spawnPos) {
    this.world = world;
    this.pos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = 0.6;
    this.height = 1.8;
    this.onGround = false;
    this.yaw = 0;   // radianos; sem clamping (dá voltas)
    this.pitch = 0; // radianos; clampado a ±89°
  }

  get eyePos() {
    return { x: this.pos.x, y: this.pos.y + EYE_HEIGHT, z: this.pos.z };
  }

  update(dt, input) {
    // Olhar.
    const { dx, dy } = input.consumeMouseDelta();
    this.yaw -= dx * MOUSE_SENS;
    this.pitch -= dy * MOUSE_SENS;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;

    // WASD projetado no plano XZ pelo yaw (W = direção do olhar horizontal).
    let forward = 0;
    let strafe = 0;
    if (input.isDown('KeyW')) forward += 1;
    if (input.isDown('KeyS')) forward -= 1;
    if (input.isDown('KeyD')) strafe += 1;
    if (input.isDown('KeyA')) strafe -= 1;

    const speed = input.isDown('ShiftLeft') ? RUN_SPEED : WALK_SPEED;
    if (forward !== 0 || strafe !== 0) {
      const len = Math.hypot(forward, strafe); // normaliza a diagonal
      const f = forward / len;
      const s = strafe / len;
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      // frente = (-sin, -cos); direita = (cos, -sin)
      this.vel.x = (f * -sinY + s * cosY) * speed;
      this.vel.z = (f * -cosY + s * -sinY) * speed;
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
    }

    // Na água, o espaço nada para cima enquanto estiver segurado — não é pulo,
    // que só sai do chão. É assim que se sobe de volta do fundo da piscina.
    if (input.isDown('Space')) {
      if (inLiquid(this.world, this)) this.vel.y = SWIM_UP;
      else if (this.onGround) this.vel.y = JUMP_SPEED;
    }

    moveEntity(this.world, this, dt);
  }
}
