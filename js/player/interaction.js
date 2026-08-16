// Interação com o mundo: mira (raycast + wireframe de destaque),
// quebrar/colocar bloco e seleção do hotbar.
import * as THREE from 'three';
import { Blocks, Owner } from '../constants.js';
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
        this.say('Nada ao alcance — chegue mais perto');
        return;
      }
      if (button === 0) {
        const b = this._target.block;
        if (!this.world.setBlock(b.x, b.y, b.z, Blocks.AIR, Owner.PLAYER)) {
          this.say('Obra dos bots — só quem construiu mexe');
        }
      } else if (button === 2) {
        const cell = this._placementCell(this._target);
        if (!cell) {
          this.say('Aí não dá — o bloco ficaria dentro de você');
          return;
        }
        if (!this.world.setBlock(cell.x, cell.y, cell.z, this.selectedBlock, Owner.PLAYER)) {
          this.say('Obra dos bots — só quem construiu mexe');
        }
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
  say(msg) {
    if (!this._toast) return;
    this._toast.textContent = msg;
    this._toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toast.classList.remove('show'), 1600);
  }

  // Onde o bloco novo vai cair, ou null se não há lugar possível.
  //
  // O destino normal é a célula vizinha à face mirada. Duas situações mandam o
  // bloco para o TOPO do bloco mirado, e as duas são a mesma queixa: passados 2
  // blocos, o topo de uma coluna fica acima da linha do olho (1,62) e a face de
  // cima some da vista — só resta a lateral, e a vizinha dela nunca é onde se
  // quer empilhar.
  //   1. a célula vizinha é do jogador (você está colado na coluna);
  //   2. você mirou a metade de cima de uma face lateral com o raio subindo —
  //      dali a face de cima é invisível, e mirar alto é pedir para subir.
  // A metade de baixo continua colocando ao lado: é assim que se estende uma
  // parede na horizontal, inclusive acima da cabeça.
  _placementCell(hit) {
    const cell = hit.prev;
    const blocked = this._isPlayerCell(cell);
    if (this._isSideFace(hit) && (blocked || this._aimedHigh(hit))) {
      const up = { x: hit.block.x, y: hit.block.y + 1, z: hit.block.z };
      if (!this.world.isSolid(up.x, up.y, up.z) && !this._isPlayerCell(up)) return up;
    }
    // Topo ocupado (ou reservado ao corpo) cai de volta na regra de sempre.
    return blocked ? null : cell;
  }

  // Face lateral de verdade. O caso "olho dentro de bloco sólido" volta com
  // normal (0,0,0) e não é face nenhuma — sem isto, subiria por engano.
  _isSideFace(hit) {
    return hit.normal.x !== 0 || hit.normal.z !== 0;
  }

  // Raio subindo e ponto mirado na metade de cima da face.
  _aimedHigh(hit) {
    if (!this._dir || this._dir.y <= 0) return false;
    const hitY = this.player.eyePos.y + this._dir.y * hit.t;
    return hitY - hit.block.y >= 0.5;
  }

  // Célula do jogador: ou o corpo está dentro dela, ou ela fica a prumo dele, da
  // altura dos pés para cima. As duas coisas são precisas: o corpo (0,6 de largura)
  // pode estar a cavalo de duas células, e uma célula acima da cabeça não toca o
  // corpo mas receberia um bloco pendurado no ar — nenhum dos dois é o que se quer
  // ao mirar uma coluna de baixo para cima.
  _isPlayerCell(cell) {
    if (this._cellIntersectsPlayer(cell)) return true;
    const p = this.player.pos;
    return cell.x === Math.floor(p.x) && cell.z === Math.floor(p.z) &&
      cell.y >= Math.floor(p.y);
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
    this._dir = dir; // guardado com o alvo: a colocação precisa saber onde se mirou

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
