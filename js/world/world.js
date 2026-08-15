// Mundo: cache de chunks gerados sob demanda, aplicação de diffs persistidos,
// edição de blocos com registro de diff e marcação de chunks dirty
// (incluindo vizinhos — diagonais — quando o bloco editado está na borda).

import { CHUNK_SIZE, CHUNK_HEIGHT, blockIndex, Blocks, chunkKey } from '../constants.js';
import { generateChunk } from './worldgen.js';
import { queueDiff } from './storage.js';

export class World {
  /**
   * @param {number} seed
   * @param {Map<string, Map<number, number>>} diffs — formato de loadAllDiffs()
   */
  constructor(seed, diffs) {
    this.seed = seed;
    this.diffs = diffs instanceof Map ? diffs : new Map();
    this.chunks = new Map();   // chunkKey -> Uint8Array
    this.dirty = new Set();    // chunkKey de chunks a re-meshear (consumidor faz clear)
  }

  /** Uint8Array do chunk; gera sob demanda, aplica diffs e cacheia. */
  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let data = this.chunks.get(key);
    if (data) return data;

    data = generateChunk(this.seed, cx, cz);
    const chunkDiffs = this.diffs.get(key);
    if (chunkDiffs) {
      for (const [idx, id] of chunkDiffs) data[idx] = id;
    }
    this.chunks.set(key, data);
    return data;
  }

  /** Id do bloco; fora de Y -> AIR; chunk inexistente -> gera. */
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return Blocks.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    return this.getChunk(cx, cz)[blockIndex(lx, wy, lz)];
  }

  /** Escreve o bloco, registra o diff e marca dirty (com vizinhos de borda). */
  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const idx = blockIndex(lx, wy, lz);

    this.getChunk(cx, cz)[idx] = id;
    queueDiff(cx, cz, idx, id);

    this.dirty.add(chunkKey(cx, cz));
    const dxs = lx === 0 ? [-1] : lx === CHUNK_SIZE - 1 ? [1] : [];
    const dzs = lz === 0 ? [-1] : lz === CHUNK_SIZE - 1 ? [1] : [];
    for (const dx of dxs) this.dirty.add(chunkKey(cx + dx, cz));
    for (const dz of dzs) this.dirty.add(chunkKey(cx, cz + dz));
    for (const dx of dxs) {
      for (const dz of dzs) this.dirty.add(chunkKey(cx + dx, cz + dz)); // diagonal
    }
  }

  /** true se o bloco não é AIR (todos os blocos v1 são sólidos). */
  isSolid(wx, wy, wz) {
    return this.getBlock(wx, wy, wz) !== Blocks.AIR;
  }

  /** y do primeiro bloco sólido de cima p/ baixo; -1 se a coluna é toda AIR. */
  surfaceHeight(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const data = this.getChunk(cx, cz);
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (data[blockIndex(lx, y, lz)] !== Blocks.AIR) return y;
    }
    return -1;
  }
}
