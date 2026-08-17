// Clima: tempo limpo, chuva e neve, alternando sozinhos.
//
// As partículas moram numa caixa que anda com o jogador. Cada gota que sai por
// baixo reaparece em cima, com x e z sorteados de novo — assim algumas centenas
// de pontos bastam para a tela inteira parecer molhada, e o custo não cresce
// com o tamanho do mundo.
//
// Chuva e neve diferem em três coisas, e as três importam para se reconhecer
// uma da outra sem legenda: velocidade de queda, deriva lateral e tamanho.

import * as THREE from 'three';

export const LIMPO = 'limpo';
export const CHUVA = 'chuva';
export const NEVE = 'neve';

// Quanto cada tempo dura, em segundos. Limpo dura mais: chuva o tempo todo
// cansa, e o que dá graça é a mudança.
const DURACAO = { [LIMPO]: 240, [CHUVA]: 120, [NEVE]: 120 };

const GOTAS = 900;
const CAIXA = 34;          // lado da caixa de partículas, em blocos
const ALTURA = 26;

const PERFIL = {
  [CHUVA]: { queda: 26, deriva: 1.4, tamanho: 0.16, cor: 0x9fc4e8, opacidade: 0.75, escuro: 0.55 },
  [NEVE]: { queda: 3.2, deriva: 2.2, tamanho: 0.34, cor: 0xffffff, opacidade: 0.9, escuro: 0.3 },
};

export class Weather {
  /**
   * @param {THREE.Scene} scene
   * @param {() => number} rnd  aleatoriedade injetável (determinismo em teste)
   */
  constructor(scene, rnd = Math.random) {
    this.rnd = rnd;
    this.kind = LIMPO;
    this.restante = DURACAO[LIMPO];
    this.onChange = null;

    const pos = new Float32Array(GOTAS * 3);
    for (let i = 0; i < GOTAS; i++) this._resetGota(pos, i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.material = new THREE.PointsMaterial({
      color: 0x9fc4e8, size: 0.16, transparent: true, opacity: 0.75,
      depthWrite: false, sizeAttenuation: true, fog: false,
    });
    this.pontos = new THREE.Points(geo, this.material);
    this.pontos.visible = false;
    this.pontos.frustumCulled = false;   // a caixa segue a câmera; cortar some tudo
    scene.add(this.pontos);
  }

  _resetGota(pos, i, emQualquerAltura) {
    pos[i * 3] = (this.rnd() - 0.5) * CAIXA;
    pos[i * 3 + 1] = emQualquerAltura ? this.rnd() * ALTURA : ALTURA;
    pos[i * 3 + 2] = (this.rnd() - 0.5) * CAIXA;
  }

  /** Quanto o clima escurece o céu, em [0,1]. */
  get darkness() {
    return this.kind === LIMPO ? 0 : PERFIL[this.kind].escuro;
  }

  /** Força um tempo (usado pelo teste e por quem quiser depurar). */
  set(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.restante = DURACAO[kind];
    const p = PERFIL[kind];
    this.pontos.visible = !!p;
    if (p) {
      this.material.color.setHex(p.cor);
      this.material.size = p.tamanho;
      this.material.opacity = p.opacidade;
    }
    if (this.onChange) this.onChange(kind);
  }

  _sortearProximo() {
    // Depois de limpo vem chuva ou neve; depois de qualquer um deles, limpo.
    // Sem essa alternância o tempo trocava de chuva para neve direto, o que
    // parece defeito, não clima.
    if (this.kind !== LIMPO) return LIMPO;
    return this.rnd() < 0.6 ? CHUVA : NEVE;
  }

  update(dt, playerPos) {
    this.restante -= dt;
    if (this.restante <= 0) this.set(this._sortearProximo());

    if (!this.pontos.visible) return;

    this.pontos.position.set(playerPos.x, playerPos.y, playerPos.z);
    const p = PERFIL[this.kind];
    const arr = this.pontos.geometry.attributes.position.array;
    const t = performance.now ? performance.now() / 1000 : 0;

    for (let i = 0; i < GOTAS; i++) {
      arr[i * 3 + 1] -= p.queda * dt;
      // A neve serpenteia; a chuva quase não. O seno por índice dá a cada
      // floco uma fase própria, sem guardar estado por partícula.
      arr[i * 3] += Math.sin(t * 1.3 + i) * p.deriva * dt;
      if (arr[i * 3 + 1] < -ALTURA * 0.35) this._resetGota(arr, i, false);
    }
    this.pontos.geometry.attributes.position.needsUpdate = true;
  }
}
