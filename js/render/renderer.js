// Cena Three.js e gerenciador de meshes de chunk.
// Um THREE.Mesh por chunk, material Lambert único com a textura do atlas.

import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_RADIUS, chunkKey } from '../constants.js';
import { buildChunkMesh } from './mesher.js';

const SKY_COLOR = 0x87ceeb;
const MESH_BUDGET_PER_UPDATE = 2; // chunks novos mesheados por chamada de update

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);

  // Fog linear casando com o raio de visão: some pouco antes da borda dos chunks.
  const viewDist = RENDER_RADIUS * CHUNK_SIZE;
  scene.fog = new THREE.Fog(SKY_COLOR, viewDist * 0.6, viewDist * 0.95);

  // Luzes devolvidas junto: quem manda nelas é o céu (js/render/sky.js), que
  // muda cor e intensidade conforme a hora do dia.
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0.6, 1.0, 0.4); // direção fixa (luz direcional usa a posição como direção)
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 400,
  );

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  return { renderer, scene, camera, sun, ambient };
}

export class ChunkRenderer {
  constructor(scene, world, atlas) {
    this.scene = scene;
    this.world = world;
    this.uvRect = atlas.uvRect;
    this.material = new THREE.MeshLambertMaterial({ map: atlas.texture });
    // Água: translúcida, desenhada depois de tudo e sem escrever profundidade —
    // com depthWrite ligado, a face da frente da piscina apagava a de trás e o
    // volume virava uma chapa azul. DoubleSide para a superfície continuar
    // visível de baixo, para quem está dentro d'água.
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.meshes = new Map();      // chunkKey -> THREE.Mesh (opaco)
    this.waterMeshes = new Map(); // chunkKey -> THREE.Mesh (água)
  }

  update(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);

    // 1) Chunks sujos (bloco editado): re-meshear já, sem orçamento.
    if (this.world.dirty.size > 0) {
      for (const key of this.world.dirty) {
        if (this.meshes.has(key)) {
          const [cx, cz] = key.split(',').map(Number);
          this._meshChunk(cx, cz, key);
        }
        // Sem mesh ainda: se estiver no raio, a fila abaixo cobre.
      }
      this.world.dirty.clear();
    }

    // 2) Remover + dispose de chunks além de RENDER_RADIUS+1.
    for (const mapa of [this.meshes, this.waterMeshes]) {
      for (const [key, mesh] of mapa) {
        const [cx, cz] = key.split(',').map(Number);
        const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
        if (dist > RENDER_RADIUS + 1) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mapa.delete(key);
        }
      }
    }

    // 3) Fila de chunks faltantes no raio, mais perto primeiro, orçamento de 2.
    const queue = [];
    for (let cx = pcx - RENDER_RADIUS; cx <= pcx + RENDER_RADIUS; cx++) {
      for (let cz = pcz - RENDER_RADIUS; cz <= pcz + RENDER_RADIUS; cz++) {
        const key = chunkKey(cx, cz);
        if (this.meshes.has(key)) continue;
        const dx = cx - pcx, dz = cz - pcz;
        queue.push({ cx, cz, key, d2: dx * dx + dz * dz });
      }
    }
    queue.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < Math.min(MESH_BUDGET_PER_UPDATE, queue.length); i++) {
      const { cx, cz, key } = queue[i];
      this._meshChunk(cx, cz, key);
    }
  }

  _meshChunk(cx, cz, key) {
    const getBlock = (wx, wy, wz) => this.world.getBlock(wx, wy, wz);
    const data = buildChunkMesh(getBlock, cx, cz, this.uvRect);
    this._apply(key, data.opaque, this.meshes, this.material, 0);
    this._apply(key, data.water, this.waterMeshes, this.waterMaterial, 1);
  }

  // Instala (ou atualiza, ou remove) a malha de um chunk num dos dois mapas.
  // Remover quando fica vazia importa: quebrar a última água de um chunk tem de
  // apagar a malha de água, senão a piscina apagada continua na tela.
  _apply(key, data, mapa, material, renderOrder) {
    const existing = mapa.get(key);
    if (data.indices.length === 0) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        mapa.delete(key);
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = true;
      mesh.renderOrder = renderOrder;
      this.scene.add(mesh);
      mapa.set(key, mesh);
    }
  }
}
