// Persistência dos diffs de blocos em IndexedDB (db "cubocraft", store "diffs").
// Uma entrada por chunk: key = chunkKey, valor = array de [blockIdx, blockId, owner].
//
// O terceiro campo é opcional e ausente significa Owner.NONE — assim um save
// gravado antes de existir posse continua carregando, com o mundo todo sem dono.
// Sem persistir o dono, bastava recarregar a página para a casa dos bots virar
// terreno livre e o jogador poder derrubá-la.
// Nada aqui toca indexedDB no import — só dentro de openStorage/flushDiffs —
// para o módulo poder ser importado em Node puro (queueDiff é só memória).

import { chunkKey } from '../constants.js';

const DB_NAME = 'cubocraft';
const STORE = 'diffs';
const FLUSH_INTERVAL_MS = 3000;

let db = null;

// Diffs já persistidos (carregados/gravados): Map<chunkKey, Map<blockIdx, blockId>>
const stored = new Map();
const storedOwners = new Map();
// Diffs acumulados em memória desde o último flush.
const pending = new Map();
const pendingOwners = new Map();

let flushTimer = null;
let listenersRegistered = false;

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Abre o IndexedDB e liga o auto-flush (intervalo de 3s + visibilitychange/pagehide).
 */
export async function openStorage() {
  if (db) return db;
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB indisponível neste ambiente');
  }

  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (flushTimer === null) {
    flushTimer = setInterval(() => {
      flushDiffs().catch((err) => console.error('flushDiffs falhou:', err));
    }, FLUSH_INTERVAL_MS);
  }

  // Listeners só quando as APIs de navegador existem (não quebra em Node).
  if (!listenersRegistered) {
    const onLeave = () => { flushDiffs().catch(() => {}); };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') onLeave();
      });
      listenersRegistered = true;
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', onLeave);
      listenersRegistered = true;
    }
  }

  return db;
}

/**
 * loadAllDiffs() -> { blocks, owners }, ambos Map<chunkKey, Map<blockIdx, valor>>
 * — `blocks` guarda o id do bloco, `owners` o dono (só as células com dono).
 */
export async function loadAllDiffs() {
  const d = await openStorage();
  const tx = d.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const [keys, values] = await Promise.all([
    requestToPromise(store.getAllKeys()),
    requestToPromise(store.getAll()),
  ]);

  const blocks = new Map();
  const owners = new Map();
  for (let i = 0; i < keys.length; i++) {
    const blockMap = new Map();
    const ownerMap = new Map();
    for (const [idx, id, owner] of values[i] || []) {
      blockMap.set(idx, id);
      if (owner) ownerMap.set(idx, owner);
    }
    blocks.set(keys[i], blockMap);
    if (ownerMap.size) owners.set(keys[i], ownerMap);
    stored.set(keys[i], new Map(blockMap)); // base para os próximos flushes
    if (ownerMap.size) storedOwners.set(keys[i], new Map(ownerMap));
  }
  return { blocks, owners };
}

/**
 * Acumula um diff em memória. Última escrita vence dentro do mesmo bloco.
 */
export function queueDiff(cx, cz, blockIdx, blockId, owner = 0) {
  const key = chunkKey(cx, cz);
  let blockMap = pending.get(key);
  if (!blockMap) {
    blockMap = new Map();
    pending.set(key, blockMap);
  }
  blockMap.set(blockIdx, blockId);

  let ownerMap = pendingOwners.get(key);
  if (!ownerMap) {
    ownerMap = new Map();
    pendingOwners.set(key, ownerMap);
  }
  ownerMap.set(blockIdx, owner);
}

/**
 * Grava o acumulado no IndexedDB (mesclando com o que já estava persistido).
 */
export async function flushDiffs() {
  if (!db || pending.size === 0) return;

  // Mescla pending -> stored e captura o snapshot a gravar.
  const toWrite = [];
  for (const [key, blockMap] of pending) {
    let base = stored.get(key);
    if (!base) {
      base = new Map();
      stored.set(key, base);
    }
    for (const [idx, id] of blockMap) base.set(idx, id);

    let baseOwners = storedOwners.get(key);
    if (!baseOwners) {
      baseOwners = new Map();
      storedOwners.set(key, baseOwners);
    }
    for (const [idx, owner] of pendingOwners.get(key) || []) {
      if (owner) baseOwners.set(idx, owner);
      else baseOwners.delete(idx);
    }

    // Célula sem dono grava só o par: o terceiro campo existe onde há posse.
    toWrite.push([key, Array.from(base.entries(), ([idx, id]) => {
      const owner = baseOwners.get(idx);
      return owner ? [idx, id, owner] : [idx, id];
    })]);
  }
  pending.clear();
  pendingOwners.clear();

  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const [key, entries] of toWrite) store.put(entries, key);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
