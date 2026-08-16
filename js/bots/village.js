// A aldeia: onde cada construção cabe, quem já construiu o quê, e a obra em
// andamento de um bot.
//
// A obra é progressiva de propósito. Uma casa que aparece inteira num frame é
// indistinguível de um bug de geração; vendo o bot assentar bloco a bloco, o
// jogador entende que aquilo ali é obra de alguém.

import { planStructure, STRUCTURE_KINDS, footprint } from '../world/structures.js';
import { Blocks } from '../constants.js';

export const MAX_STRUCTURES = 6;    // teto por sessão, para a aldeia não virar cidade
export const SITE_MIN_DIST = 11;    // blocos entre construções
export const SPAWN_CLEAR = 7;       // raio livre em torno do spawn do jogador
export const BLOCKS_PER_SECOND = 9; // ritmo de assentamento
const FOUNDATION_DEPTH = 10;        // até onde o alicerce desce atrás de apoio
const SITE_TRIES = 40;
const MAX_SLOPE = 2;                // desnível tolerado no terreno do sítio

/** A célula [c, c+1)³ toca a AABB de alguma entidade? */
function occupiedBy(occupants, cx, cy, cz) {
  for (const e of occupants) {
    if (!e || !e.pos) continue;
    const half = (e.width || 0.6) / 2;
    const h = e.height || 1.8;
    if (cx + 1 > e.pos.x - half && cx < e.pos.x + half
      && cy + 1 > e.pos.y && cy < e.pos.y + h
      && cz + 1 > e.pos.z - half && cz < e.pos.z + half) return true;
  }
  return false;
}

/** Obra em andamento: uma fila de blocos que o bot assenta aos poucos. */
export class BuildJob {
  constructor(world, origin, plan) {
    this.world = world;
    this.origin = origin;           // { x, y, z } — y é o piso (local y = 0)
    this.plan = plan;
    this.queue = plan.blocks.map(([x, y, z, id]) => [x, y, z, id]);
    this.credit = 0;

    // Alicerce: o terreno raramente é uma mesa. Sem preencher do chão até o
    // piso, a construção fica pairando com um degrau impossível na entrada.
    //
    // A varredura desce célula a célula até achar apoio — e não usa
    // surfaceHeight, que numa coluna com árvore devolve o topo da copa. Com a
    // copa como referência, o alicerce começava acima do piso, não preenchia
    // nada, e a obra limpava a árvore deixando um vão embaixo.
    const fp = footprint(plan);
    const base = [];
    for (let z = fp.z0; z <= fp.z1; z++) {
      for (let x = fp.x0; x <= fp.x1; x++) {
        const wx = origin.x + x;
        const wz = origin.z + z;
        for (let y = origin.y - 1; y > origin.y - 1 - FOUNDATION_DEPTH; y--) {
          if (world.isSolid(wx, y, wz)) break;
          base.push([x, y - origin.y, z, Blocks.STONE]);
        }
      }
    }
    this.queue = [...base, ...this.queue];
    this.total = this.queue.length;
  }

  get done() { return this.queue.length === 0; }
  get progress() { return this.total === 0 ? 1 : 1 - this.queue.length / this.total; }

  /** Ponto onde o bot fica enquanto trabalha: à frente da porta, do lado de fora. */
  get standPoint() {
    const door = this.plan.door;
    const dx = door ? door.x : Math.floor(this.plan.w / 2);
    const dz = door ? door.z : -1;
    return { x: this.origin.x + dx + 0.5, z: this.origin.z + dz - 1.5 };
  }

  /**
   * Assenta o que couber em `dt` segundos.
   *
   * `occupants` são as entidades vivas (bots e jogador). Bloco que cairia em
   * cima de alguém volta para o fim da fila em vez de ser assentado: sem isto a
   * obra emparedava quem estivesse na soleira — inclusive o próprio pedreiro,
   * que fica parado ali o tempo todo.
   */
  step(dt, occupants = []) {
    this.credit += dt * BLOCKS_PER_SECOND;
    let tentativas = this.queue.length;
    while (this.credit >= 1 && this.queue.length && tentativas > 0) {
      this.credit -= 1;
      tentativas -= 1;
      const item = this.queue.shift();
      const [x, y, z, id] = item;
      const wx = this.origin.x + x;
      const wy = this.origin.y + y;
      const wz = this.origin.z + z;
      if (id !== Blocks.AIR && occupiedBy(occupants, wx, wy, wz)) {
        this.queue.push(item);   // depois, quando quem está ali tiver saído
        continue;
      }
      this.world.setBlock(wx, wy, wz, id);
    }
    return this.done;
  }
}

export class Village {
  constructor(world, spawn, rnd = Math.random) {
    this.world = world;
    this.spawn = spawn;
    this.rnd = rnd;
    this.structures = [];           // { kind, origin, door: {x,z}, bounds }
  }

  get full() { return this.structures.length >= MAX_STRUCTURES; }

  /** Porta mais próxima de (x,z) dentro de `maxDist`, em coordenadas de mundo. */
  nearestDoor(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const s of this.structures) {
      if (!s.door) continue;
      const d = Math.hypot(s.door.x - x, s.door.z - z);
      if (d < bestD) { bestD = d; best = s.door; }
    }
    return best;
  }

  _freeOf(bounds) {
    for (const s of this.structures) {
      const dx = Math.max(s.bounds.x0 - bounds.x1, bounds.x0 - s.bounds.x1, 0);
      const dz = Math.max(s.bounds.z0 - bounds.z1, bounds.z0 - s.bounds.z1, 0);
      if (Math.hypot(dx, dz) < SITE_MIN_DIST) return false;
    }
    return true;
  }

  /**
   * Procura terreno para uma construção nova perto de (cx,cz). Devolve a obra
   * pronta para começar, ou null se não achou lugar — o que é comum em terreno
   * quebrado, e por isso o bot volta a vaguear em vez de insistir.
   */
  planNear(cx, cz) {
    if (this.full) return null;
    const kind = STRUCTURE_KINDS[Math.floor(this.rnd() * STRUCTURE_KINDS.length)];
    const plan = planStructure(kind, this.rnd);
    const fp = footprint(plan);

    for (let t = 0; t < SITE_TRIES; t++) {
      const ang = this.rnd() * Math.PI * 2;
      const dist = 8 + this.rnd() * 14;
      const ox = Math.round(cx + Math.cos(ang) * dist);
      const oz = Math.round(cz + Math.sin(ang) * dist);

      const bounds = { x0: ox + fp.x0, z0: oz + fp.z0, x1: ox + fp.x1, z1: oz + fp.z1 };

      // Longe do spawn: casa em cima de quem acabou de entrar no jogo é armadilha.
      const near = Math.hypot((bounds.x0 + bounds.x1) / 2 - this.spawn.x,
        (bounds.z0 + bounds.z1) / 2 - this.spawn.z);
      if (near < SPAWN_CLEAR) continue;
      if (!this._freeOf(bounds)) continue;

      // Terreno: mede o desnível de todo o retângulo, não só dos cantos.
      let lo = Infinity;
      let hi = -Infinity;
      let ok = true;
      for (let z = bounds.z0; z <= bounds.z1 && ok; z++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          const h = this.world.surfaceHeight(x, z);
          if (h < 1) { ok = false; break; }
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      if (!ok || hi - lo > MAX_SLOPE) continue;

      const origin = { x: ox, y: hi + 1, z: oz };
      // A porta olha para -Z, então "dentro" é alguns blocos em +Z. O bot visita
      // parando na soleira e depois entrando: parar na porta é ficar de fora.
      const door = plan.door
        ? {
          x: origin.x + plan.door.x + 0.5,
          y: origin.y,
          z: origin.z + plan.door.z + 0.5,
          inside: {
            x: origin.x + plan.door.x + 0.5,
            z: origin.z + plan.door.z + 0.5 + Math.abs(plan.door.z) + 2,
          },
        }
        : null;
      this.structures.push({ kind, origin, door, bounds });
      return new BuildJob(this.world, origin, plan);
    }
    return null;
  }
}
