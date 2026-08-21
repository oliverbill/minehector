// Ponto de vista: primeira pessoa, terceira por trás e terceira de frente, com
// o boneco do jogador aparecendo nas duas últimas. Tecla V alterna (F5 seria a
// convenção, mas no navegador F5 recarrega a página).
//
// A câmera de terceira pessoa não é só "recuar 4 blocos": recuada às cegas, ela
// atravessa a parede atrás e o jogador passa a ver o mundo por dentro do
// terreno, sem entender por quê. Por isso o recuo é medido pelo mesmo raycast
// que a mira usa, e para antes do primeiro bloco sólido.

import { createAvatar, HEITOR } from '../bots/avatar.js';
import { createHandPickaxe } from '../render/pickaxe.js';
import { raycastVoxel } from './raycast.js';

export const FIRST = 0;
export const THIRD_BACK = 1;
export const THIRD_FRONT = 2;
export const MODE_NAMES = ['1ª pessoa', '3ª pessoa', '3ª pessoa (de frente)'];

const DIST = 4.2;       // recuo máximo da câmera, em blocos
const MARTELO_APOS_CLIQUE = 0.6;   // s que o martelo fica à mostra depois do clique
const WALL_MARGIN = 0.4; // folga até a parede: encostado, o near plane a corta

export class View {
  /**
   * @param {import('../world/world.js').World} world
   * @param {object} player
   * @param {THREE.Scene} scene
   * @param {object} input
   * @param {(mode: number) => void} [onChange] — para a HUD contar o que mudou
   */
  constructor(world, player, scene, input, onChange) {
    this.world = world;
    this.player = player;
    this.mode = FIRST;
    this.onChange = onChange;

    this.scene = scene;
    this.avatar = createAvatar('Heitor', 0x1c1c1f, HEITOR);
    this.avatar.group.visible = false;
    scene.add(this.avatar.group);

    // A picareta em primeira pessoa. Em terceira ela está na mão do boneco, e
    // sem esta o jogador em primeira pessoa não teria mão nenhuma na tela — o
    // mundo inteiro atravessado por uma mira flutuante. É ela que diz com o que
    // se está batendo, e é o que mais rápido faz o jogo parecer um jogo.
    //
    // Filha da CÂMERA, não da cena: pendurada na cena, teria de ser
    // reposicionada por trigonometria a cada frame, e qualquer atraso de um
    // frame entre olhar e ferramenta se lê na hora como tranco.
    this.mao = createHandPickaxe();
    this._maoPendurada = false;

    // Aviso de submerso. Fica aqui e não na Interaction porque quem sabe onde a
    // câmera está é a View — e é a posição do OLHO que decide, não a do corpo:
    // com água pelo peito você continua vendo o mundo normalmente.
    this._underwater = typeof document !== 'undefined'
      ? document.getElementById('underwater')
      : null;

    if (input && input.onKeyPress) {
      input.onKeyPress((code) => { if (code === 'KeyV') this.cycle(); });
    }
    // O jogador não tem "obra" como os bots: a obra dele é o clique. Cada clique
    // acende o martelo por um instante, e cliques seguidos emendam numa
    // martelada contínua — que é como se constrói de verdade.
    if (input && input.onMouseButton) {
      input.onMouseButton(() => { this._buildFor = MARTELO_APOS_CLIQUE; });
    }
    this._buildFor = 0;
  }

  cycle() {
    this.mode = (this.mode + 1) % 3;
    if (this.onChange) this.onChange(this.mode);
    return this.mode;
  }

  /** Direção horizontal+vertical do olhar, igual à da Interaction. */
  _lookDir() {
    const cosP = Math.cos(this.player.pitch);
    return {
      x: cosP * -Math.sin(this.player.yaw),
      y: Math.sin(this.player.pitch),
      z: cosP * -Math.cos(this.player.yaw),
    };
  }

  /** Até onde a câmera pode recuar em `dir` sem entrar em bloco sólido. */
  _freeDistance(eye, dir) {
    const hit = raycastVoxel(this.world, eye, dir, DIST);
    if (!hit) return DIST;
    return Math.max(0, hit.t - WALL_MARGIN);
  }

  /**
   * Põe o boneco onde o jogador está, anima e posiciona a câmera.
   * Chamado todo frame, depois da física.
   */
  update(dt, camera) {
    const p = this.player;
    const g = this.avatar.group;

    this._buildFor = Math.max(0, this._buildFor - dt);

    g.visible = this.mode !== FIRST;
    if (g.visible) {
      g.position.set(p.pos.x, p.pos.y, p.pos.z);
      // O rosto do boneco é a face +Z; o jogador com yaw 0 olha para -Z. É a
      // mesma conta que o bot faz com a sua velocidade.
      g.rotation.y = p.yaw + Math.PI;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.avatar.animate(dt, speed, p.onGround, p.pitch, this._buildFor > 0);
    }

    const eye = p.eyePos;
    camera.rotation.order = 'YXZ';

    // A câmera entra na cena junto com a picareta: o Three só percorre (e
    // desenha) os filhos de quem está no grafo, e uma câmera solta fora dele
    // levaria a ferramenta para lugar nenhum. Feito uma vez, no primeiro frame,
    // porque é aqui que a câmera aparece — o construtor não a recebe.
    if (!this._maoPendurada) {
      camera.add(this.mao.group);
      this.scene.add(camera);
      this._maoPendurada = true;
    }
    this.mao.group.visible = this.mode === FIRST;
    this.mao.animate(dt, this._buildFor > 0);

    if (this._underwater) {
      const submerso = this.world.isWater(
        Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z),
      );
      this._underwater.classList.toggle('on', submerso);
    }

    if (this.mode === FIRST) {
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.set(p.pitch, p.yaw, 0);
      return;
    }

    const look = this._lookDir();
    // Por trás: recua no contrário do olhar. De frente: avança no olhar e vira a
    // câmera 180°, para o boneco ficar de cara para quem joga.
    const sign = this.mode === THIRD_BACK ? -1 : 1;
    const dir = { x: look.x * sign, y: look.y * sign, z: look.z * sign };
    const d = this._freeDistance(eye, dir);

    camera.position.set(eye.x + dir.x * d, eye.y + dir.y * d, eye.z + dir.z * d);
    if (this.mode === THIRD_BACK) camera.rotation.set(p.pitch, p.yaw, 0);
    else camera.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
  }
}
