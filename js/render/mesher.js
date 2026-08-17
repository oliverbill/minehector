// Mesher de chunk — função pura, sem THREE, sem DOM (testável em Node).
// Posições em coordenadas de MUNDO. 4 vértices + 2 triângulos por face,
// winding counter-clockwise visto de fora (padrão do Three.js).
//
// Duas malhas por chunk, não uma: a opaca e a da água. A água é translúcida e
// tem de ser desenhada depois do resto, com material próprio — misturada na
// mesma geometria, ou o fundo da piscina sumia atrás dela, ou ela virava um
// bloco azul opaco.
//
// Culling, agora com três casos em vez de um:
//   - sólido contra AR ou contra ÁGUA -> emite (é a parede da piscina vista de
//     dentro d'água; sem isto o fundo do buraco ficava transparente);
//   - água contra AR -> emite (a superfície e as laterais expostas);
//   - água contra água ou contra sólido -> não emite (nada de plano interno
//     dentro do volume de água, que só produziria faces piscando).

import { CHUNK_SIZE, CHUNK_HEIGHT, Blocks, isWater, isPlant } from '../constants.js';

// Placas cruzadas de uma planta: dois quadriláteros nas diagonais da célula,
// inteiros (de baixo a cima). Sem culling nenhum — planta é vista dos dois
// lados, e o material dela usa alphaTest para o resto da célula sumir.
const CRUZ = [
  { a: [0.15, 0.15], b: [0.85, 0.85] },
  { a: [0.85, 0.15], b: [0.15, 0.85] },
];

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

function buffer() {
  return { positions: [], normals: [], uvs: [], indices: [], vertCount: 0 };
}

function freeze(b) {
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: new Float32Array(b.uvs),
    indices: new Uint32Array(b.indices),
  };
}

// Uma placa da cruz: quatro vértices em pé, com a textura inteira da célula.
function plantQuad(b, wx, wy, wz, rect, corte) {
  const { a, b: c } = corte;
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  const pontos = [
    [a[0], 0, a[1], 0, 0],
    [c[0], 0, c[1], 1, 0],
    [c[0], 1, c[1], 1, 1],
    [a[0], 1, a[1], 0, 1],
  ];
  for (const [ox, oy, oz, cu, cv] of pontos) {
    b.positions.push(wx + ox, wy + oy, wz + oz);
    b.normals.push(0, 1, 0);          // normal para cima: pega a luz do céu
    b.uvs.push(rect.u0 + cu * du, rect.v0 + cv * dv);
  }
  b.indices.push(
    b.vertCount, b.vertCount + 1, b.vertCount + 2,
    b.vertCount, b.vertCount + 2, b.vertCount + 3,
  );
  b.vertCount += 4;
}

/** @returns {{opaque, water, plants}} — três geometrias prontas. */
export function buildChunkMesh(getBlock, cx, cz, uvRect) {
  const opaque = buffer();
  const water = buffer();
  const plants = buffer();

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

        if (isPlant(id)) {
          const rect = uvRect(id, 2);
          for (const corte of CRUZ) plantQuad(plants, wx, wy, wz, rect, corte);
          continue;
        }

        const souAgua = isWater(id);
        const b = souAgua ? water : opaque;

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const viz = getBlock(wx + dx, wy + dy, wz + dz);
          // Vizinho que não tapa: ar, planta (que é quase toda vazia) e — para
          // quem não é água — a própria água.
          const vizinhoVazio = viz === Blocks.AIR || isPlant(viz)
            || (!souAgua && isWater(viz));
          if (!vizinhoVazio) continue;

          const rect = uvRect(id, face.kind);
          const du = rect.u1 - rect.u0;
          const dv = rect.v1 - rect.v0;

          for (const [ox, oy, oz, cu, cv] of face.corners) {
            b.positions.push(wx + ox, wy + oy, wz + oz);
            b.normals.push(dx, dy, dz);
            b.uvs.push(rect.u0 + cu * du, rect.v0 + cv * dv);
          }
          b.indices.push(
            b.vertCount, b.vertCount + 1, b.vertCount + 2,
            b.vertCount, b.vertCount + 2, b.vertCount + 3,
          );
          b.vertCount += 4;
        }
      }
    }
  }

  return { opaque: freeze(opaque), water: freeze(water), plants: freeze(plants) };
}
