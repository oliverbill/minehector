// Céu e ciclo do dia: cor do céu e da névoa, sol, lua, estrelas e nuvens.
//
// O dia tem três períodos de MINUTOS_POR_PERIODO minutos — manhã, tarde e noite
// — e a passagem entre eles é interpolada, não chaveada. Corte seco de cor lê
// como bug de render; o que se quer é o entardecer acontecendo enquanto se joga.
//
// Tudo aqui é decoração: nada neste módulo altera o mundo, a física ou os bots.
// Por isso ele recebe a cena e as luzes prontas e só mexe em cor, posição e
// visibilidade — é seguro desligar sem quebrar o jogo.

import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_RADIUS } from '../constants.js';

export const MINUTOS_POR_PERIODO = 15;
export const PERIODO = MINUTOS_POR_PERIODO * 60;   // segundos
export const DIA = PERIODO * 3;

export const MANHA = 'manhã';
export const TARDE = 'tarde';
export const NOITE = 'noite';

// Cada marco é um instante do ciclo com o seu clima de luz. O que estiver entre
// dois marcos é a mistura dos dois, na proporção da distância.
//
// `luz` é a intensidade da direcional (o "sol"), `ambiente` a da luz de
// preenchimento — de noite ela não vai a zero, senão o jogo fica injogável em
// vez de escuro.
const MARCOS = [
  { t: 0.00, ceu: 0x9ad2f0, luz: 0.55, cor: 0xffe6c0, ambiente: 0.52, nome: MANHA },
  { t: 0.12, ceu: 0x87ceeb, luz: 0.85, cor: 0xffffff, ambiente: 0.66, nome: MANHA },
  { t: 0.33, ceu: 0x87ceeb, luz: 0.90, cor: 0xffffff, ambiente: 0.68, nome: TARDE },
  { t: 0.55, ceu: 0x8fc4e8, luz: 0.80, cor: 0xfff0d8, ambiente: 0.62, nome: TARDE },
  { t: 0.63, ceu: 0xe89a52, luz: 0.55, cor: 0xffb070, ambiente: 0.50, nome: TARDE }, // poente
  { t: 0.68, ceu: 0x6a4a70, luz: 0.28, cor: 0xc08cb0, ambiente: 0.36, nome: NOITE },
  { t: 0.80, ceu: 0x0b1026, luz: 0.10, cor: 0x9fb4e0, ambiente: 0.22, nome: NOITE },
  { t: 0.95, ceu: 0x1a2a4a, luz: 0.16, cor: 0xc0cbe8, ambiente: 0.30, nome: NOITE },
  { t: 1.00, ceu: 0x9ad2f0, luz: 0.55, cor: 0xffe6c0, ambiente: 0.52, nome: MANHA },
];

// Fração do ciclo em que ainda é dia: manhã e tarde (dois períodos de três),
// com uma folga para o sol encostar no horizonte junto com o poente dos marcos.
const DIA_FRACAO = 0.66;

const DIST_CEU = 260;      // sol, lua e estrelas moram longe, atrás da névoa
const ALT_NUVEM = 78;
const NUVENS = 42;

function lerpCor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

/** Painel plano sempre de frente para a câmera (sol e lua). */
function disco(cor, tamanho, opacidade = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(tamanho, tamanho),
    new THREE.MeshBasicMaterial({
      color: cor, transparent: true, opacity: opacidade,
      depthWrite: false, fog: false,
    }),
  );
  m.renderOrder = -10;   // atrás de tudo: é o fundo do mundo
  return m;
}

export class Sky {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.DirectionalLight} sun    a direcional criada em createScene
   * @param {THREE.AmbientLight} ambient
   * @param {number} [t0] instante inicial do ciclo, em segundos
   */
  constructor(scene, sun, ambient, t0 = PERIODO * 0.35) {
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;
    this.time = t0;               // começa de manhã, com o dia já claro

    this.grupo = new THREE.Group();
    scene.add(this.grupo);

    this.sol = disco(0xfff4c8, 26);
    this.lua = disco(0xe8ecf5, 16);
    this.grupo.add(this.sol, this.lua);

    this.estrelas = this._estrelas();
    this.grupo.add(this.estrelas);

    this.nuvens = this._nuvens();
    this.grupo.add(this.nuvens);
  }

  // Estrelas: pontos numa cúpula. Só a metade de cima, porque abaixo do
  // horizonte elas ficariam dentro do terreno.
  _estrelas() {
    const pos = [];
    let s = 20260817;
    const rnd = () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 420; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 0.95);      // evita o zênite exato
      pos.push(
        Math.sin(phi) * Math.cos(theta) * DIST_CEU,
        Math.cos(phi) * DIST_CEU * 0.9 + 10,
        Math.sin(phi) * Math.sin(theta) * DIST_CEU,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
  }

  // Nuvens: placas achatadas de tamanhos variados, altas e lentas. Placa e não
  // volume porque de baixo só se vê a barriga da nuvem — e porque assim custa
  // uma geometria só.
  _nuvens() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      depthWrite: false, fog: false,
    });
    this._nuvemMat = mat;   // uma só para todas: a cor da hora se aplica de uma vez
    let s = 7717;
    const rnd = () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    const alcance = RENDER_RADIUS * CHUNK_SIZE * 2.2;
    for (let i = 0; i < NUVENS; i++) {
      const w = 14 + rnd() * 26;
      const d = 10 + rnd() * 18;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), mat);
      m.position.set(
        (rnd() - 0.5) * alcance,
        ALT_NUVEM + rnd() * 10,
        (rnd() - 0.5) * alcance,
      );
      g.add(m);
    }
    g.userData.alcance = alcance;
    return g;
  }

  /** Fração do ciclo, em [0, 1). */
  get fraction() { return (this.time % DIA) / DIA; }

  /** 'manhã' | 'tarde' | 'noite' — o período em que o relógio está agora. */
  get phase() {
    const p = Math.floor((this.time % DIA) / PERIODO);
    return [MANHA, TARDE, NOITE][p];
  }

  /** Quanto falta, em segundos, para o próximo período. */
  get untilNext() {
    return PERIODO - ((this.time % DIA) % PERIODO);
  }

  /** Estado de luz interpolado entre os dois marcos que cercam o instante. */
  _estado() {
    const f = this.fraction;
    let a = MARCOS[0];
    let b = MARCOS[MARCOS.length - 1];
    for (let i = 0; i < MARCOS.length - 1; i++) {
      if (f >= MARCOS[i].t && f <= MARCOS[i + 1].t) { a = MARCOS[i]; b = MARCOS[i + 1]; break; }
    }
    const span = b.t - a.t || 1;
    const k = Math.min(1, Math.max(0, (f - a.t) / span));
    return {
      ceu: lerpCor(a.ceu, b.ceu, k),
      cor: lerpCor(a.cor, b.cor, k),
      luz: a.luz + (b.luz - a.luz) * k,
      ambiente: a.ambiente + (b.ambiente - a.ambiente) * k,
      noite: Math.min(1, Math.max(0, (f - 0.62) / 0.10)) * (f < 0.97 ? 1 : (1 - f) / 0.03),
    };
  }

  /**
   * @param {number} dt          segundos
   * @param {{x,y,z}} playerPos  o céu acompanha o jogador, senão ele "sai" do mundo
   * @param {number} [escuro]    escurecimento extra do clima, em [0,1]
   */
  update(dt, playerPos, escuro = 0) {
    this.time += dt;
    const e = this._estado();
    const k = 1 - escuro * 0.45;

    const ceu = e.ceu.clone().multiplyScalar(k);
    this.scene.background = ceu;
    if (this.scene.fog) this.scene.fog.color = ceu;

    this.sun.color = e.cor;
    this.sun.intensity = e.luz * (1 - escuro * 0.5);
    this.ambient.intensity = e.ambiente * (1 - escuro * 0.25);

    // O sol nasce no começo da manhã e se põe no fim da tarde: o arco inteiro
    // cabe nos dois primeiros períodos, e não no ciclo todo. Espalhá-lo pelas
    // 45 minutos punha o sol abaixo do horizonte em plena manhã — que foi
    // exatamente o que o teste pegou.
    const diurno = this.fraction / DIA_FRACAO;    // 0 no nascer, 1 no poente
    const arco = Math.PI * diurno;
    const sx = -Math.cos(arco) * DIST_CEU;        // nasce a leste, morre a oeste
    const sy = Math.sin(arco) * DIST_CEU * 0.85;

    this.grupo.position.set(playerPos.x, 0, playerPos.z);
    this.sol.position.set(sx, sy, -DIST_CEU * 0.35);
    this.lua.position.set(-sx, -sy, DIST_CEU * 0.35);
    this.sol.visible = sy > -30;
    this.lua.visible = -sy > -30;
    for (const disc of [this.sol, this.lua]) {
      disc.lookAt(playerPos.x, disc.position.y + 0, playerPos.z);
      disc.position.x += playerPos.x - this.grupo.position.x;
    }

    // A direcional é a luz do astro que está no céu. O `+40` mantém uma
    // inclinação mínima: luz rasante demais deixa faces inteiras de bloco sem
    // iluminação nenhuma, e o terreno vira recorte preto.
    const luzX = sy > 0 ? sx : -sx;
    this.sun.position.set(luzX, Math.abs(sy) + 40, 120);

    this.estrelas.material.opacity = e.noite * 0.9;
    this.estrelas.visible = e.noite > 0.02;

    // Nuvens andam devagar e voltam para perto quando o jogador se afasta, para
    // o céu nunca ficar careca de um lado.
    const alcance = this.nuvens.userData.alcance;
    this.nuvens.position.x += dt * 0.6;
    if (this.nuvens.position.x > alcance / 2) this.nuvens.position.x -= alcance;
    for (const n of this.nuvens.children) {
      const dx = n.position.x + this.nuvens.position.x;
      if (dx > alcance / 2) n.position.x -= alcance;
      if (dx < -alcance / 2) n.position.x += alcance;
    }
    // Nuvem branca à meia-noite denuncia que ela não faz parte do céu: a nuvem
    // não tem luz própria, ela devolve a luz que recebe. Aqui ela recebe a cor
    // e a força do astro da hora.
    const brilho = Math.min(1, 0.30 + e.luz * 0.85) * k;
    this._nuvemMat.color.copy(e.cor).multiplyScalar(brilho);
    this._nuvemMat.opacity = 0.85 * (0.55 + 0.45 * k);
  }
}
