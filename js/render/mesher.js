// Mesher de chunk — função pura, sem THREE, sem DOM (testável em Node).
// Emite uma face somente quando o vizinho na direção dela é AIR (culling).
// Posições em coordenadas de MUNDO. 4 vértices + 2 triângulos por face,
// winding counter-clockwise visto de fora (padrão do Three.js).

import { CHUNK_SIZE, CHUNK_HEIGHT, Blocks } from '../constants.js';

// Tabela das 6 direções. Cada corner: [ox, oy, oz, cu, cv] (offsets 0/1 no cubo
// e coordenada UV local dentro do retângulo da célula; cv=1 é o topo da textura).
// Triângulos sempre (0,1,2) e (0,2,3), CCW visto de fora.
// kind: 0=topo(+Y), 1=fundo(-Y), 2=lado(±X/±Z) — casa com uvRect(blockId, face).
const FACES = [
  { // +Y (topo)
    dir: [0, 1, 0], kind: 0,
    corners: [
      [0, 1, 0, 0, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [1, 1, 0, 1, 1],
    ],
  },
  { // -Y (fundo)
    dir: [0, -1, 0], kind: 1,
    corners: [
      [0, 0, 0, 0, 0],
      [1, 0, 0, 1, 0],
      [1, 0, 1, 1, 1],
      [0, 0, 1, 0, 1],
    ],
  },
  { // +X (lado)
    dir: [1, 0, 0], kind: 2,
    corners: [
      [1, 0, 0, 0, 0],
      [1, 1, 0, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 1, 1, 0],
    ],
  },
  { // -X (lado)
    dir: [-1, 0, 0], kind: 2,
    corners: [
      [0, 0, 1, 0, 0],
      [0, 1, 1, 0, 1],
      [0, 1, 0, 1, 1],
      [0, 0, 0, 1, 0],
    ],
  },
  { // +Z (lado)
    dir: [0, 0, 1], kind: 2,
    corners: [
      [0, 0, 1, 0, 0],
      [1, 0, 1, 1, 0],
      [1, 1, 1, 1, 1],
      [0, 1, 1, 0, 1],
    ],
  },
  { // -Z (lado)
    dir: [0, 0, -1], kind: 2,
    corners: [
      [0, 0, 0, 1, 0],
      [0, 1, 0, 1, 1],
      [1, 1, 0, 0, 1],
      [1, 0, 0, 0, 0],
    ],
  },
];

export function buildChunkMesh(getBlock, cx, cz, uvRect) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertCount = 0;

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wy = y;
        const wz = baseZ + z;
        const id = getBlock(wx, wy, wz);
        if (id === Blocks.AIR) continue;

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          if (getBlock(wx + dx, wy + dy, wz + dz) !== Blocks.AIR) continue;

          const rect = uvRect(id, face.kind);
          const du = rect.u1 - rect.u0;
          const dv = rect.v1 - rect.v0;

          for (const [ox, oy, oz, cu, cv] of face.corners) {
            positions.push(wx + ox, wy + oy, wz + oz);
            normals.push(dx, dy, dz);
            uvs.push(rect.u0 + cu * du, rect.v0 + cv * dv);
          }
          indices.push(
            vertCount, vertCount + 1, vertCount + 2,
            vertCount, vertCount + 2, vertCount + 3,
          );
          vertCount += 4;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}
