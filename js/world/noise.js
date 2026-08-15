// Ruído Perlin 2D implementado à mão, determinístico por seed.
// Sem dependências externas; roda em navegador e em Node puro.

// PRNG mulberry32 — determinístico a partir de um inteiro de 32 bits.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gradientes unitários (8 direções) — suficientes para Perlin 2D suave.
const GRADS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

// Quintic fade de Perlin (6t^5 - 15t^4 + 10t^3).
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * makeNoise2D(seed) -> (x, z) => valor em [-1, 1], determinístico p/ mesma seed.
 */
export function makeNoise2D(seed) {
  // Tabela de permutação embaralhada com Fisher–Yates seedado.
  const rand = mulberry32(seed | 0);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const gradDot = (hash, dx, dz) => {
    const g = GRADS[hash & 7];
    return g[0] * dx + g[1] * dz;
  };

  return function noise2D(x, z) {
    const xf = Math.floor(x);
    const zf = Math.floor(z);
    const xi = xf & 255;
    const zi = zf & 255;
    const dx = x - xf;
    const dz = z - zf;

    const u = fade(dx);
    const v = fade(dz);

    const aa = perm[perm[xi] + zi];
    const ba = perm[perm[xi + 1] + zi];
    const ab = perm[perm[xi] + zi + 1];
    const bb = perm[perm[xi + 1] + zi + 1];

    const n00 = gradDot(aa, dx, dz);
    const n10 = gradDot(ba, dx - 1, dz);
    const n01 = gradDot(ab, dx, dz - 1);
    const n11 = gradDot(bb, dx - 1, dz - 1);

    // Perlin 2D cru fica em [-sqrt(2)/2, sqrt(2)/2]; normaliza para [-1, 1].
    const raw = lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * Math.SQRT2;
    return raw < -1 ? -1 : raw > 1 ? 1 : raw;
  };
}
