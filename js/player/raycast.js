// Raycast em grade de voxels — DDA de Amanatides & Woo.
// Função pura: sem THREE, sem DOM. `dir` deve estar normalizado; maxDist em blocos.
//
// `hits` decide o que o raio acerta; o padrão é bloco sólido. A mira passa um
// predicado mais largo, que inclui a água — sem isso não haveria como apagar a
// água de uma piscina, já que ela não é sólida.
//
// A saída de emergência da origem continua olhando só para SÓLIDO de propósito:
// ela existe para o olho preso dentro de geometria, e água não prende ninguém.
// Se ela respondesse à água, quem estivesse nadando miraria a própria célula a
// cada clique e não conseguiria acertar mais nada.

const HITS_SOLID = (world, x, y, z) => world.isSolid(x, y, z);

export function raycastVoxel(world, origin, dir, maxDist, hits = HITS_SOLID) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  // Origem já dentro de bloco sólido: retorna a própria célula.
  if (world.isSolid(x, y, z)) {
    return {
      block: { x, y, z },
      prev: { x, y, z },
      normal: { x: 0, y: 0, z: 0 },
      t: 0,
    };
  }

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  // Distância (em t) para atravessar uma célula inteira em cada eixo.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // t até a primeira fronteira de célula em cada eixo.
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) / dir.x
    : stepX < 0 ? (x - origin.x) / dir.x
    : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) / dir.y
    : stepY < 0 ? (y - origin.y) / dir.y
    : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) / dir.z
    : stepZ < 0 ? (z - origin.z) / dir.z
    : Infinity;

  for (;;) {
    let nx = 0, ny = 0, nz = 0;
    let t;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX;
    } else if (tMaxY <= tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; ny = -stepY;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nz = -stepZ;
    }
    if (t > maxDist) return null;
    if (hits(world, x, y, z)) {
      return {
        block: { x, y, z },
        prev: { x: x + nx, y: y + ny, z: z + nz },
        normal: { x: nx, y: ny, z: nz },
        t, // distância até a face; origin + dir*t é o ponto mirado dentro da face
      };
    }
  }
}
