// Mundo: cache de chunks gerados sob demanda, aplicação de diffs persistidos,
// edição de blocos com registro de diff e marcação de chunks dirty
// (incluindo vizinhos — diagonais — quando o bloco editado está na borda).

import { CHUNK_SIZE, CHUNK_HEIGHT, blockIndex, Blocks, chunkKey, Owner } from '../constants.js';
import { generateChunk } from './worldgen.js';
import { queueDiff } from './storage.js';

export class World {
  /**
   * @param {number} seed
   * @param {Map<string, Map<number, number>>} diffs — blocos de loadAllDiffs()
   * @param {Map<string, Map<number, number>>} owners — donos de loadAllDiffs()
   */
  constructor(seed, diffs, owners) {
    this.seed = seed;
    this.diffs = diffs instanceof Map ? diffs : new Map();
    // Só as células já editadas entram aqui; o terreno virgem não tem dono e não
    // ocupa memória. Mesmo formato dos diffs: chunkKey -> Map<blockIdx, Owner>.
    this.owners = owners instanceof Map ? owners : new Map();
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

  /** De quem é a célula: Owner.NONE quando ninguém a editou ainda. */
  ownerOf(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return Owner.NONE;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const chunkOwners = this.owners.get(chunkKey(cx, cz));
    if (!chunkOwners) return Owner.NONE;
    return chunkOwners.get(blockIndex(lx, wy, lz)) ?? Owner.NONE;
  }

  /** `by` pode escrever nesta célula? Terreno virgem é de todos; o resto, do dono. */
  canEdit(wx, wy, wz, by = Owner.NONE) {
    const dono = this.ownerOf(wx, wy, wz);
    return dono === Owner.NONE || dono === by;
  }

  /**
   * Escreve o bloco, registra o diff e marca dirty (com vizinhos de borda).
   *
   * `by` é quem está escrevendo. A escrita é recusada — sem efeito nenhum — se a
   * célula já for de outro; quando passa, `by` fica dono dela. É o único ponto
   * por onde o mundo muda, e por isso é aqui que a regra de posse mora: qualquer
   * caminho novo de edição herda a proteção sem precisar lembrar dela.
   *
   * @returns {boolean} true se o bloco foi escrito.
   */
  setBlock(wx, wy, wz, id, by = Owner.NONE) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    if (!this.canEdit(wx, wy, wz, by)) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const idx = blockIndex(lx, wy, lz);

    this.getChunk(cx, cz)[idx] = id;
    this._setOwner(cx, cz, idx, by);
    queueDiff(cx, cz, idx, id, by);

    this.dirty.add(chunkKey(cx, cz));
    const dxs = lx === 0 ? [-1] : lx === CHUNK_SIZE - 1 ? [1] : [];
    const dzs = lz === 0 ? [-1] : lz === CHUNK_SIZE - 1 ? [1] : [];
    for (const dx of dxs) this.dirty.add(chunkKey(cx + dx, cz));
    for (const dz of dzs) this.dirty.add(chunkKey(cx, cz + dz));
    for (const dx of dxs) {
      for (const dz of dzs) this.dirty.add(chunkKey(cx + dx, cz + dz)); // diagonal
    }
    return true;
  }

  _setOwner(cx, cz, idx, by) {
    const key = chunkKey(cx, cz);
    let chunkOwners = this.owners.get(key);
    if (by === Owner.NONE) {
      if (chunkOwners) chunkOwners.delete(idx);
      return;
    }
    if (!chunkOwners) {
      chunkOwners = new Map();
      this.owners.set(key, chunkOwners);
    }
    chunkOwners.set(idx, by);
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
