// Interação com o mundo: mira (raycast + wireframe de destaque),
// quebrar/colocar bloco e seleção do hotbar.
import * as THREE from 'three';
import { Blocks } from '../constants.js';
import { raycastVoxel } from './raycast.js';

// Alcance em blocos, medido a partir do olho. Com 5 a mira já falhava em
// terreno que desce à frente — o chão ficava a 5,07 e o clique não fazia nada.
const REACH = 6;

export class Interaction {
  constructor(world, player, scene, input) {
    this.world = world;
    this.player = player;
    this.selectedBlock = Blocks.GRASS;
    this._target = null;
    this._crosshair = document.getElementById('crosshair');
    this._toast = document.getElementById('toast');
    this._toastTimer = null;

    // Branco, sempre por cima do terreno: um contorno preto translúcido some
    // contra pedra e sombra, e sem ver o alvo o jogador acha que o jogo travou.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this._highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false,
      })
    );
    this._highlight.renderOrder = 999;
    this._highlight.visible = false;
    scene.add(this._highlight);

    input.onMouseButton((button) => {
      if (!this._target) {
        this._say('Nada ao alcance — chegue mais perto');
        return;
      }
      if (button === 0) {
        const b = this._target.block;
        this.world.setBlock(b.x, b.y, b.z, Blocks.AIR);
      } else if (button === 2) {
        const p = this._target.prev;
        if (this._cellIntersectsPlayer(p)) {
          this._say('Aí não dá — o bloco ficaria dentro de você');
          return;
        }
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

  // Recado curto no centro da tela. Sem isto, uma recusa é indistinguível de
  // um jogo quebrado: o clique não faz nada e nada explica por quê.
  _say(msg) {
    if (!this._toast) return;
    this._toast.textContent = msg;
    this._toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toast.classList.remove('show'), 1600);
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
    // A mira também avisa: apagada quando não há bloco no alcance.
    if (this._crosshair) this._crosshair.classList.toggle('idle', !hit);
  }
}
