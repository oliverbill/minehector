// Interação com o mundo: mira (raycast + wireframe de destaque),
// quebrar/colocar bloco e seleção do hotbar.
import * as THREE from 'three';
import { Blocks } from '../constants.js';
import { raycastVoxel } from './raycast.js';

const REACH = 5; // alcance em blocos

export class Interaction {
  constructor(world, player, scene, input) {
    this.world = world;
    this.player = player;
    this.selectedBlock = Blocks.GRASS;
    this._target = null;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this._highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
    );
    this._highlight.visible = false;
    scene.add(this._highlight);

    input.onMouseButton((button) => {
      if (!this._target) return;
      if (button === 0) {
        const b = this._target.block;
        this.world.setBlock(b.x, b.y, b.z, Blocks.AIR);
      } else if (button === 2) {
        const p = this._target.prev;
        if (this._cellIntersectsPlayer(p)) return;
        this.world.setBlock(p.x, p.y, p.z, this.selectedBlock);
      }
    });

    input.onKeyPress((code) => {
      const match = /^Digit([1-6])$/.exec(code);
      if (!match) return;
      this.selectedBlock = Number(match[1]); // Digit1..Digit6 -> ids 1..6
      for (const slot of document.querySelectorAll('#hotbar .slot')) {
        slot.classList.toggle('active', Number(slot.dataset.block) === this.selectedBlock);
      }
    });
  }

  // AABB do bloco novo [cell, cell+1)³ contra a AABB do jogador.
  _cellIntersectsPlayer(cell) {
    const p = this.player;
    const half = p.width / 2;
    return (
      cell.x + 1 > p.pos.x - half && cell.x < p.pos.x + half &&
      cell.y + 1 > p.pos.y && cell.y < p.pos.y + p.height &&
      cell.z + 1 > p.pos.z - half && cell.z < p.pos.z + half
    );
  }

  update() {
    const eye = this.player.eyePos;
    const cosP = Math.cos(this.player.pitch);
    const dir = {
      x: cosP * -Math.sin(this.player.yaw),
      y: Math.sin(this.player.pitch),
      z: cosP * -Math.cos(this.player.yaw),
    };
    const hit = raycastVoxel(this.world, eye, dir, REACH);
    this._target = hit;

    if (hit) {
      this._highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
      this._highlight.visible = true;
    } else {
      this._highlight.visible = false;
    }
  }
}
