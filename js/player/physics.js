// Física compartilhada (jogador e bots). Funções puras: sem THREE, sem DOM.
import { GRAVITY } from '../constants.js';

const EPS = 1e-4;        // folga nas bordas da AABB para não prender em quinas
const MAX_FALL = 50;     // velocidade terminal de queda (blocos/s)

// AABB da entidade: [pos.x ± width/2, pos.y .. pos.y+height, pos.z ± width/2]
// (pos = centro da BASE, os "pés").
function intersectsSolid(world, pos, width, height) {
  const half = width / 2;
  const x0 = Math.floor(pos.x - half + EPS);
  const x1 = Math.floor(pos.x + half - EPS);
  const y0 = Math.floor(pos.y + EPS);
  const y1 = Math.floor(pos.y + height - EPS);
  const z0 = Math.floor(pos.z - half + EPS);
  const z1 = Math.floor(pos.z + half - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

// Move a entidade num único eixo e resolve colisão encostando na face do bloco.
// Retorna true se colidiu (a componente da velocidade deve ser zerada pelo caller).
function sweepAxis(world, entity, axis, delta) {
  if (delta === 0) return false;
  const { pos, width, height } = entity;
  pos[axis] += delta;
  if (!intersectsSolid(world, pos, width, height)) return false;

  const half = width / 2;
  if (axis === 'y') {
    if (delta < 0) {
      pos.y = Math.floor(pos.y + EPS) + 1;            // pés no topo do bloco
    } else {
      pos.y = Math.floor(pos.y + height - EPS) - height; // cabeça sob o bloco
    }
  } else {
    if (delta > 0) {
      pos[axis] = Math.floor(pos[axis] + half - EPS) - half;
    } else {
      pos[axis] = Math.floor(pos[axis] - half + EPS) + 1 + half;
    }
  }
  return true;
}

export function moveEntity(world, entity, dt) {
  const vel = entity.vel;

  vel.y -= GRAVITY * dt;
  if (vel.y < -MAX_FALL) vel.y = -MAX_FALL;

  entity.onGround = false;

  // Substeps: nenhum eixo avança mais de meio bloco por passo — sem isso,
  // um engasgo de frame durante uma queda rápida atravessa blocos finos
  // e deixa a entidade presa dentro do terreno.
  const maxDelta =
    Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxDelta / 0.5));
  const sdt = dt / steps;

  // Integração eixo a eixo: X, depois Z, depois Y.
  for (let i = 0; i < steps; i++) {
    if (sweepAxis(world, entity, 'x', vel.x * sdt)) vel.x = 0;
    if (sweepAxis(world, entity, 'z', vel.z * sdt)) vel.z = 0;

    const dy = vel.y * sdt;
    if (sweepAxis(world, entity, 'y', dy)) {
      if (dy < 0) entity.onGround = true; // colisão em Y descendo = chão
      vel.y = 0;
    }
  }
}
