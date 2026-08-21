// Ovelhas: o primeiro bicho do mundo que não é gente. Diretório próprio
// (`js/mobs/`) porque bicho não é bot: não tem nome, não constrói, não segue
// ninguém e — ao contrário dos bots — pode morrer. Misturar os dois em
// `js/bots/` faria a pasta querer dizer "tudo que anda", que não quer dizer nada.
//
// A FSM vive em `SheepBrain`, classe pura (sem THREE, sem world, sem DOM) com
// rng injetado, exatamente como `BotBrain`. É o mesmo motivo de lá: a decisão de
// para onde ir é a parte que dá defeito difícil de ver, e ela só é testável em
// Node se não arrastar consigo a cena, a malha e o mundo. `Sheep` embrulha o
// cérebro com o corpo, a física e a animação; `SheepManager` cuida do rebanho.
//
// **A ovelha não foge de quem passa perto.** Foi a primeira coisa tentada e é a
// pior: um bicho que dispara ao ver o jogador transforma caçar em correr atrás
// do horizonte, e como ela é mais lenta que o jogador a caçada vira uma
// perseguição chata em vez de uma pancada. Ela só entra em `flee` quando apanha
// (`panic`) — aí sim corre, por ~5 s e bem mais rápido do que anda, que é o
// bastante para o jogador ter de acertar a segunda martelada em movimento. Fora
// disso ela pasta, cochila e vagueia num raio curto: um rebanho parado no campo
// é o que faz o jogador decidir ir até lá.
//
// **A morte é uma animação, não um sumiço.** Ovelha que desaparece no instante
// da última martelada não confirma nada — o jogador fica sem saber se matou ou
// se ela fugiu para trás de uma árvore. Então ela para de andar, tomba de lado
// em meio segundo e só depois o gerente a tira da cena. No meio do tombo ela já
// não é acertável: golpear cadáver renderia vida infinita de uma ovelha só.
//
// **A pintura é a mesma dos bots** — `surface`, `material` e `shade` vêm de
// `js/render/pixelart.js`, não de uma cópia. Canvas por face, `NearestFilter`,
// granulado por meio-U. Duas implementações do mesmo pixel art divergem na
// primeira correção, e ovelha lisa ao lado de um boneco granulado parece ter
// vindo de outro jogo. A lã leva granulado bem mais forte que o tecido dos
// bots: sem isso a ovelha é uma caixa branca, e caixa branca já existe (areia,
// pedra clara ao sol) — o que a faz ler como bicho é a superfície revolta.

import * as THREE from 'three';
import { surface, material, shade } from '../render/pixelart.js';
import { moveEntity } from '../player/physics.js';
import { Blocks } from '../constants.js';

// ---------------------------------------------------------------------------
// Contrato de entidade e de vida
// ---------------------------------------------------------------------------
export const SHEEP_WIDTH = 0.9;
export const SHEEP_HEIGHT = 1.3;
export const SHEEP_HEALTH = 3;      // marteladas até cair

// ---------------------------------------------------------------------------
// Parâmetros da FSM / movimento
// ---------------------------------------------------------------------------
export const WALK_SPEED = 1.6;    // blocos/s — mais lenta que o jogador (4.3)
// Em pânico ela corre 4,9: mais que os 4,3 de quem anda e menos que os 5,6 de
// quem corre. É esse intervalo que faz da caça uma perseguição — andando, a
// ovelha escapa; correndo, ela é alcançada, e correr gasta o fôlego que a carne
// dela vai repor. Fora desse intervalo o laço todo desanda: 4,2 se pegava
// andando, e 5,7 não se pegava nunca.
export const FLEE_SPEED = 4.9;
export const JUMP_SPEED = 7.2;    // blocos/s: sobe 1 bloco com folga, e só

export const IDLE_MIN = 2.5;      // s parada, respirando
export const IDLE_MAX = 5;
export const GRAZE_MIN = 3;       // s de cabeça no chão
export const GRAZE_MAX = 7;
export const GRAZE_CHANCE = 0.45; // e o resto se divide entre vaguear e nada
export const WANDER_CHANCE = 0.30;
export const WANDER_RANGE = 6;    // blocos: o passeio da ovelha é curto
export const WANDER_TIMEOUT = 5;  // s até desistir do alvo
export const WANDER_ARRIVE = 0.5; // blocos: chegou
export const FLEE_TIME = 5;       // s correndo depois da pancada
export const FLEE_AHEAD = 10;     // blocos à frente, na direção contrária ao golpe
export const ALERT_DIST = 2.2;    // blocos: alguém encostou, cabeça para cima
export const THREAT_DIST = 6;     // blocos: fugindo, o perseguidor vira a ameaça
export const FALL_TIME = 0.5;     // s do tombo de lado depois de morta

// ---------------------------------------------------------------------------
// Parâmetros do rebanho
// ---------------------------------------------------------------------------
export const THINK_INTERVAL = 0.3; // s entre decisões de uma ovelha
export const SPAWN_MIN = 14;       // blocos: nasce longe o bastante para não
export const SPAWN_MAX = 34;       // aparecer na cara do jogador, e perto o
                                   // bastante para ele topar com ela andando
export const SPAWN_TRIES = 8;      // tentativas de terreno por chamada
export const DESPAWN_DIST = 80;    // blocos: além disto, recolhe e renasce perto

// ---------------------------------------------------------------------------
// FSM pura — sem THREE, sem world, sem DOM.
// ---------------------------------------------------------------------------
export class SheepBrain {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.state = 'idle';
    this.timer = IDLE_MIN + rng() * (IDLE_MAX - IDLE_MIN);
    this.target = null;    // { x, z } em wander/flee, senão null
    this.threat = null;    // de onde veio a pancada
    // Última posição conhecida, gravada em `update`. O cérebro é puro e não tem
    // corpo: `panic(px, pz)` só recebe de onde veio o golpe, e para saber para
    // que lado correr precisa saber onde ela estava.
    this.x = null;
    this.z = null;
  }

  /**
   * Tick de pensamento (~0.3s). ctx = { x, z, playerDist }. Devolve o estado.
   */
  update(elapsed, ctx) {
    this.x = ctx.x;
    this.z = ctx.z;
    this.timer -= elapsed;

    if (this.state === 'flee') {
      // O alvo é recalculado a cada tick, sempre à frente: alvo fixo seria
      // alcançado no meio do pânico e a ovelha pararia de correr olhando para
      // quem a acertou.
      this.target = this._paraLonge(ctx.x, ctx.z);
      if (this.timer <= 0) this._toIdle();
      return this.state;
    }

    if (this.state === 'idle') {
      if (this.timer <= 0) this._decideNext();
    } else if (this.state === 'pastando') {
      // Levanta a cabeça quando alguém encosta. Não é fuga — é o que faz a
      // ovelha parecer viva quando o jogador chega ao lado dela, e é a única
      // reação dela à presença de alguém que não bateu.
      if (this.timer <= 0 || ctx.playerDist < ALERT_DIST) this._toIdle();
    } else if (this.state === 'wander') {
      const d = Math.hypot(this.target.x - ctx.x, this.target.z - ctx.z);
      if (d < WANDER_ARRIVE || this.timer <= 0) this._toIdle();
    }
    return this.state;
  }

  /**
   * Levou pancada (ou alguém chegou perto demais): corre na direção contrária
   * ao ponto (px, pz) por FLEE_TIME segundos.
   */
  panic(px, pz) {
    this.threat = { x: px, z: pz };
    this.state = 'flee';
    this.timer = FLEE_TIME;
    // Sem posição conhecida ainda (pânico antes do primeiro tick), o alvo sai
    // no primeiro `update` — que acontece no mesmo frame do golpe.
    this.target = this.x === null ? null : this._paraLonge(this.x, this.z);
  }

  _toIdle() {
    this.state = 'idle';
    this.timer = IDLE_MIN + this.rng() * (IDLE_MAX - IDLE_MIN);
    this.target = null;
  }

  // Do ocioso ela vai pastar, vaguear ou continuar ociosa. A soma das duas
  // primeiras chances é menor que 1 de propósito: rebanho que decide alguma
  // coisa a cada 4 segundos fica inquieto demais, e o que se quer ver é um
  // campo de bichos parados com um ou outro andando.
  _decideNext() {
    const r = this.rng();
    if (r < GRAZE_CHANCE) {
      this.state = 'pastando';
      this.timer = GRAZE_MIN + this.rng() * (GRAZE_MAX - GRAZE_MIN);
      this.target = null;
      return;
    }
    if (r < GRAZE_CHANCE + WANDER_CHANCE) {
      const ang = this.rng() * Math.PI * 2;
      const dist = 1.5 + this.rng() * (WANDER_RANGE - 1.5);
      this.state = 'wander';
      this.timer = WANDER_TIMEOUT;
      this.target = {
        x: this.x + Math.cos(ang) * dist,
        z: this.z + Math.sin(ang) * dist,
      };
      return;
    }
    this._toIdle();
  }

  _paraLonge(x, z) {
    let dx = x - this.threat.x;
    let dz = z - this.threat.z;
    let len = Math.hypot(dx, dz);
    // Golpe vindo de cima, ou de dentro dela: sem direção para fugir, sorteia
    // uma. Correr para lugar nenhum ainda é melhor que ficar parada apanhando.
    if (len < 1e-6) {
      const ang = this.rng() * Math.PI * 2;
      dx = Math.cos(ang);
      dz = Math.sin(ang);
      len = 1;
    }
    return { x: x + (dx / len) * FLEE_AHEAD, z: z + (dz / len) * FLEE_AHEAD };
  }
}

// ---------------------------------------------------------------------------
// O corpo: ovelha voxel pintada como o avatar dos bots
// ---------------------------------------------------------------------------

// Unidade do modelo. 26 U de altura para casar com os 1,3 blocos da AABB: patas
// 5 + corpo 13 + cabeça sobrando por cima até as orelhas. Como no avatar, toda
// medida abaixo está em U, para as proporções não escorregarem se a altura mudar.
const U = SHEEP_HEIGHT / 26;

// Ordem das faces numa BoxGeometry do Three: +X, -X, +Y, -Y, +Z, -Z.
// A frente é +Z, como nos bots (`mesh.rotation.y = atan2(vel.x, vel.z)`).
const RIGHT = 0, LEFT = 1, TOP = 2, BOTTOM = 3, FRONT = 4, BACK = 5;

// Medidas do bicho, em U.
const CORPO_W = 16, CORPO_H = 13, CORPO_D = 23;   // 23 U ≈ 1,15 de comprimento
const CORPO_Y = 11.5;                             // centro do tronco
const PATA_W = 4, PATA_H = 5;
const PATA_X = 5.5, PATA_Z = 7.5;
const CABECA = 8;
const CABECA_Y = 20.5, CABECA_Z = 12;
const FOCINHO_W = 5, FOCINHO_H = 3.5, FOCINHO_D = 2;
const ORELHA_W = 3, ORELHA_H = 1.5, ORELHA_D = 2;

// Lã creme suja, não branca: branco puro contra neve ou areia ao sol some, e
// contra grama vira um recorte de papel. O creme tem cor para sombrear.
const LA = [230, 223, 205];
const COURO = [196, 186, 168];     // cabeça: mais escura que a lã, como no bicho
const FOCINHO = [242, 238, 229];
const PATA_COR = [66, 58, 52];
const CASCO = [38, 33, 30];
const OLHO = [30, 26, 24];

/**
 * As seis faces de uma caixa w×h×d. As faces de um paralelepípedo têm três
 * tamanhos diferentes e trocar um deles estica a textura sem erro nenhum
 * aparecer — daí a tabela, em vez de seis chamadas escritas à mão.
 */
function faces6(w, h, d, pinta) {
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  return [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK].map((face) => {
    const [fw, fh] = dims[face];
    const s = surface(fw, fh);
    pinta(s, face, fw, fh);
    return material(s.canvas);
  });
}

// Lã: granulado forte mais tufos de meio-U espalhados. O granulado sozinho dá
// textura mas não dá volume; são os tufos, com uma sombra logo abaixo de cada
// um, que fazem a superfície parecer felpuda em vez de ruidosa.
function pintaLa(s, base, w, h, rnd) {
  s.grain(0, 0, w, h, base, 34, rnd);
  const tufos = Math.max(4, Math.round(w * h * 0.2));
  for (let i = 0; i < tufos; i++) {
    const tx = rnd() * Math.max(0.5, w - 1.5);
    const ty = rnd() * Math.max(0.5, h - 1);
    const c = shade(base, rnd() < 0.5 ? -32 : 28);
    s.rect(tx, ty, 1.5, 0.5, c);
    s.rect(tx + 0.5, ty + 0.5, 1, 0.5, shade(c, -16));
  }
}

function corpoFaces(rnd) {
  return faces6(CORPO_W, CORPO_H, CORPO_D, (s, face, w, h) => {
    // Barriga na sombra e lombo no claro: sem essa diferença o tronco é um
    // bloco de cor única e a luz do jogo não basta para dar volume a ele.
    const base = face === BOTTOM ? shade(LA, -44) : face === TOP ? shade(LA, 12) : LA;
    pintaLa(s, base, w, h, rnd);
    if (face === BACK) {
      // Rabinho: uma mancha de lã mais escura no meio da garupa. Barato, e é o
      // que diz de que lado está a traseira quando ela está de costas.
      s.rect(w / 2 - 1.5, 2, 3, 4, shade(LA, -34));
      s.rect(w / 2 - 1, 2.5, 2, 3, shade(LA, -14));
    }
  });
}

function cabecaFaces(rnd) {
  return faces6(CABECA, CABECA, CABECA, (s, face, w, h) => {
    if (face === BACK) {
      // Onde a cabeça encosta no tronco é lã, não couro.
      pintaLa(s, LA, w, h, rnd);
      return;
    }
    if (face === BOTTOM) {
      s.grain(0, 0, w, h, shade(COURO, -34), 12, rnd);
      return;
    }
    s.grain(0, 0, w, h, COURO, 14, rnd);
    if (face === TOP) {
      // Topete: a lã do corpo invade a testa. É o detalhe que impede a cabeça
      // de parecer uma caixa marrom encostada numa caixa branca.
      pintaLa(s, LA, w, 3.5, rnd);
      return;
    }
    if (face === FRONT) {
      pintaLa(s, LA, w, 2, rnd);                       // franja da testa
      // Olhos pequenos e bem separados, como os de um herbívoro. Grandes e
      // juntos, no meio da cara, a ovelha fica com expressão de desenho — e a
      // ovelha é comida, não personagem.
      s.rect(1, 2.75, 1.5, 1.25, [246, 244, 238]);
      s.rect(5.5, 2.75, 1.5, 1.25, [246, 244, 238]);
      s.rect(1.5, 3, 0.75, 0.75, OLHO);
      s.rect(6, 3, 0.75, 0.75, OLHO);
      s.rect(1.5, 3, 0.25, 0.25, [236, 240, 248]);     // brilho na íris
      s.rect(6, 3, 0.25, 0.25, [236, 240, 248]);
      return;
    }
    // Laterais: lã descendo da testa e a bochecha na sombra.
    pintaLa(s, LA, w, 2, rnd);
    s.rect(face === RIGHT ? 0 : w - 1, 2, 1, 4, shade(COURO, -22));
  });
}

function focinhoFaces(rnd) {
  return faces6(FOCINHO_W, FOCINHO_H, FOCINHO_D, (s, face, w, h) => {
    s.grain(0, 0, w, h, FOCINHO, 12, rnd);
    if (face === FRONT) {
      s.rect(0.75, 1.25, 1, 0.75, shade(FOCINHO, -70));   // narinas
      s.rect(w - 1.75, 1.25, 1, 0.75, shade(FOCINHO, -70));
      s.rect(1.25, 2.5, w - 2.5, 0.5, shade(FOCINHO, -46)); // boca
    }
  });
}

function orelhaFaces(rnd) {
  return faces6(ORELHA_W, ORELHA_H, ORELHA_D, (s, _face, w, h) => {
    s.grain(0, 0, w, h, shade(COURO, -14), 12, rnd);
  });
}

function pataFaces(rnd) {
  return faces6(PATA_W, PATA_H, PATA_W, (s, face, w, h) => {
    if (face === TOP) {
      pintaLa(s, LA, w, h, rnd);          // o alto da pata some dentro da lã
      return;
    }
    if (face === BOTTOM) {
      s.grain(0, 0, w, h, CASCO, 8, rnd);
      return;
    }
    s.grain(0, 0, w, h, PATA_COR, 16, rnd);
    s.rect(0, 0, w, 1, shade(LA, -20));   // franja de lã na canela
    s.rect(0, h - 1, w, 1, CASCO);        // casco
  });
}

// ---------------------------------------------------------------------------
// Pelagens: as texturas são compartilhadas, não feitas por ovelha
// ---------------------------------------------------------------------------
//
// Cada ovelha usa 30 texturas de canvas (seis faces × cinco peças). Fazê-las no
// construtor custaria 180 texturas num rebanho de seis — e, pior, o rebanho se
// repovoa: cada ovelha que se afasta e renasce alocaria trinta texturas novas
// que ninguém dá dispose, e a memória de GPU subiria sozinha durante a partida
// inteira. Três pelagens montadas uma única vez, sorteadas por ovelha, dão a
// variação que se enxerga (rebanho de clones não incomoda ninguém: rebanho de
// verdade é assim) com custo fixo.
//
// As pelagens saem de sementes fixas, e não do rng injetado, pelo mesmo motivo
// que a skin dos bots sai do hash do nome: a mesma ovelha tem de sair igual
// entre sessões e entre máquinas, e o rng injetado existe para a IA ser testável,
// não para sortear textura.
const PELAGENS = 3;
const pelagens = [];

function rngSemente(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function pelagem(i) {
  if (pelagens[i]) return pelagens[i];
  const rnd = rngSemente(0x5eed + i * 7919);
  pelagens[i] = {
    corpo: corpoFaces(rnd),
    cabeca: cabecaFaces(rnd),
    focinho: focinhoFaces(rnd),
    orelha: orelhaFaces(rnd),
    pata: pataFaces(rnd),
  };
  return pelagens[i];
}

// Geometria também é compartilhada: são cinco caixas de tamanhos fixos, e uma
// BoxGeometry nova por ovelha renascida é lixo de GPU pela mesma porta.
const geometrias = new Map();
function geometria(w, h, d) {
  const chave = `${w}x${h}x${d}`;
  let g = geometrias.get(chave);
  if (!g) {
    g = new THREE.BoxGeometry(w * U, h * U, d * U);
    geometrias.set(chave, g);
  }
  return g;
}

function caixa(w, h, d, mats, penduraNoTopo) {
  const mesh = new THREE.Mesh(geometria(w, h, d), mats);
  // Pata pendurada pelo topo: o pivô fica na articulação e a caixa desce meia
  // altura, senão o balanço vira hélice em vez de passada.
  if (penduraNoTopo) mesh.position.y = (-h / 2) * U;
  return mesh;
}

function pivotAt(x, y, z, filho) {
  const g = new THREE.Group();
  g.position.set(x * U, y * U, z * U);
  g.add(filho);
  return g;
}

/**
 * Ovelha de voxel. Devolve { group, animate(dt, speed, pastando) }; o group tem
 * origem nos PÉS, como a `pos` da física. Sem nome flutuando: bicho não tem nome
 * — a plaquinha é o que separa, à distância, o vizinho da caça.
 */
function createSheepBody(rnd) {
  const group = new THREE.Group();
  const pele = pelagem(Math.floor(rnd() * PELAGENS) % PELAGENS);

  const corpo = caixa(CORPO_W, CORPO_H, CORPO_D, pele.corpo, false);
  corpo.position.y = CORPO_Y * U;

  const cabeca = pivotAt(0, CABECA_Y, CABECA_Z, caixa(CABECA, CABECA, CABECA, pele.cabeca, false));
  // Focinho e orelhas penduram na cabeça: têm de descer com ela quando a ovelha
  // pasta, senão ficam flutuando onde a cabeça estava.
  const focinho = caixa(FOCINHO_W, FOCINHO_H, FOCINHO_D, pele.focinho, false);
  focinho.position.set(0, -1.25 * U, (CABECA / 2 + FOCINHO_D / 2 - 0.5) * U);
  cabeca.add(focinho);

  for (const lado of [-1, 1]) {
    const orelha = caixa(ORELHA_W, ORELHA_H, ORELHA_D, pele.orelha, false);
    orelha.position.set(lado * (CABECA / 2 + ORELHA_W / 2 - 0.5) * U, 2.5 * U, -0.5 * U);
    orelha.rotation.z = lado * 0.35;   // caídas para os lados, não em pé
    cabeca.add(orelha);
  }

  // Ordem: frente-esq, frente-dir, trás-esq, trás-dir. O trote é diagonal (as
  // patas cruzadas se movem juntas) — quadrúpede que mexe os dois pares em
  // paralelo parece pular, não andar.
  const patas = [
    pivotAt(-PATA_X, PATA_H, PATA_Z, caixa(PATA_W, PATA_H, PATA_W, pele.pata, true)),
    pivotAt(PATA_X, PATA_H, PATA_Z, caixa(PATA_W, PATA_H, PATA_W, pele.pata, true)),
    pivotAt(-PATA_X, PATA_H, -PATA_Z, caixa(PATA_W, PATA_H, PATA_W, pele.pata, true)),
    pivotAt(PATA_X, PATA_H, -PATA_Z, caixa(PATA_W, PATA_H, PATA_W, pele.pata, true)),
  ];

  group.add(corpo, cabeca, ...patas);

  let fase = rnd() * Math.PI * 2;   // o rebanho não marcha em sincronia
  let balanco = 0;
  let relogio = rnd() * 10;
  let pasto = 0;                    // 0 = cabeça alta, 1 = focinho no chão

  return {
    group,
    /** Quanto a cabeça está abaixada, em [0,1] — para teste e para quem quiser. */
    get pastando() { return pasto; },
    /**
     * @param {number} dt        segundos desde o último frame
     * @param {number} speed     velocidade horizontal real, em blocos/s
     * @param {boolean} pastando estado 'pastando': cabeça descendo até o chão
     */
    animate(dt, speed, pastando) {
      relogio += dt;

      // A passada acompanha a velocidade real; parada, o balanço morre em vez
      // de congelar no meio do passo. Mesma regra do avatar — ovelha que patina
      // denuncia a animação tanto quanto bot que patina.
      fase += dt * (2.2 + speed * 3.4);
      const querido = Math.min(0.7, speed * 0.42);
      balanco += (querido - balanco) * Math.min(1, dt * 9);
      const s = Math.sin(fase) * balanco;
      patas[0].rotation.x = s;
      patas[3].rotation.x = s;
      patas[1].rotation.x = -s;
      patas[2].rotation.x = -s;

      // Desce rápido e volta devagar: abaixar a cabeça é uma decisão, levantar
      // é preguiça. Com a mesma velocidade nos dois sentidos o pescoço parece
      // uma mola.
      pasto += ((pastando ? 1 : 0) - pasto) * Math.min(1, dt * (pastando ? 4 : 1.6));

      // Só girar o pescoço não chega ao chão: o pivô está a 1,0 de altura e a
      // cabeça mede 0,4. A cabeça também DESCE, como a de um bicho que dobra o
      // pescoço, e avança um pouco para não entrar no próprio peito.
      cabeca.position.set(0, (CABECA_Y - 11 * pasto) * U, (CABECA_Z + 2 * pasto) * U);
      // Girar +X empurra a face +Z (o focinho) para baixo.
      cabeca.rotation.x = 1.15 * pasto
        + pasto * Math.sin(relogio * 6) * 0.07          // mordidas
        + (1 - pasto) * Math.sin(relogio * 0.6) * 0.05; // cabeceio à toa

      const ocioso = 1 - Math.min(1, balanco / 0.25);
      cabeca.rotation.y = (1 - pasto) * ocioso * Math.sin(relogio * 0.5) * 0.25;
      // Respiração: o tronco sobe e desce um fio quando ela está parada. Sem
      // isto a ovelha ociosa é uma estátua, e estátua não vale a caminhada.
      corpo.position.y = (CORPO_Y + Math.sin(relogio * 1.4) * 0.14 * ocioso) * U;
    },
  };
}

// ---------------------------------------------------------------------------
// Sheep: entidade física + cérebro + mesh
// ---------------------------------------------------------------------------
export class Sheep {
  /** @param {{x:number,y:number,z:number}} pos — centro da BASE (contrato de moveEntity). */
  constructor(pos, rng = Math.random) {
    this.pos = { x: pos.x, y: pos.y, z: pos.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = SHEEP_WIDTH;
    this.height = SHEEP_HEIGHT;
    this.onGround = false;

    this.health = SHEEP_HEALTH;
    this.fall = 0;              // progresso do tombo, em [0,1]

    this.brain = new SheepBrain(rng);
    // Um tick de tempo zero só para o cérebro nascer sabendo onde o corpo está:
    // sem isso, uma pancada antes do primeiro pensamento não teria de onde
    // calcular a direção da fuga.
    this.brain.update(0, { x: this.pos.x, z: this.pos.z, playerDist: Infinity });

    // Escalonamento do pensamento: cada ovelha nasce com um deslocamento
    // sorteado dentro do intervalo. O BotManager usa round-robin porque a
    // lista dele é fixa; aqui o rebanho nasce e morre, e sorteio não precisa
    // de reindexação a cada baixa.
    this.thinkTimer = rng() * THINK_INTERVAL;
    this.sinceThink = 0;

    this.yaw = rng() * Math.PI * 2;
    this.targetYaw = this.yaw;

    this.body = createSheepBody(rng);
    this.mesh = this.body.group;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }

  get dead() { return this.health <= 0; }

  /** Está caindo de lado depois de morta? Enquanto tomba, ainda está na cena. */
  get tombando() { return this.dead && this.fall < 1; }

  /** Tick de IA (~0.3s). */
  think(elapsed, playerPos) {
    if (this.dead) return;
    const dist = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    // Em fuga, quem estiver colado nela vira a nova ameaça. Sem isto, o jogador
    // que dá a volta por fora faz a ovelha correr direto para os braços dele —
    // ela fugiria do lugar onde apanhou, não de quem bateu.
    if (this.brain.state === 'flee' && dist < THREAT_DIST) {
      this.brain.threat = { x: playerPos.x, z: playerPos.z };
    }
    this.brain.update(elapsed, { x: this.pos.x, z: this.pos.z, playerDist: dist });
  }

  /**
   * Steering por frame: seta vel.x/vel.z na direção do alvo do estado atual e
   * pula o degrau. `playerPos` entra pelo mesmo contrato do `Bot.steer` e não é
   * usado — ovelha não persegue ninguém, e quem a assusta já foi tratado no
   * `think`.
   */
  steer(world, playerPos) { // eslint-disable-line no-unused-vars
    if (this.dead) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }

    const b = this.brain;
    const alvo = (b.state === 'wander' || b.state === 'flee') ? b.target : null;
    if (!alvo) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }

    const dx = alvo.x - this.pos.x;
    const dz = alvo.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }
    const nx = dx / len;
    const nz = dz / len;
    const v = b.state === 'flee' ? FLEE_SPEED : WALK_SPEED;
    this.vel.x = nx * v;
    this.vel.z = nz * v;

    // Pulo de degrau, como o do bot: bloco sólido na altura dos pés logo à
    // frente e as células que ela ocupa livres acima dele.
    //
    // Ela tem 1,3 e não 1,8, e a tentação é conferir uma célula só — mas 1,3
    // atravessa a divisa da célula: de pé sobre um bloco, os pés ficam em fy+1
    // e a cabeça em fy+2,3, ou seja, ela ocupa DUAS células, exatamente como o
    // bot. Conferir só uma faria a ovelha pular para dentro de um teto de um
    // bloco de folga e ficar batendo a cabeça, presa contra a parede — que é o
    // pior defeito possível aqui, porque é permanente e silencioso.
    if (this.onGround) {
      const reach = this.width / 2 + 0.35;
      const bx = Math.floor(this.pos.x + nx * reach);
      const bz = Math.floor(this.pos.z + nz * reach);
      const fy = Math.floor(this.pos.y + 0.01);
      if (
        world.isSolid(bx, fy, bz) &&
        !world.isSolid(bx, fy + 1, bz) &&
        !world.isSolid(bx, fy + 2, bz)
      ) {
        this.vel.y = JUMP_SPEED;
      }
    }
  }

  /** Posição, rotação suavizada e animação. */
  syncMesh(dt) {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    if (this.dead) {
      // Tomba de lado em FALL_TIME, com suavização nas duas pontas: queda
      // linear parece um interruptor, e o que se quer é ver o bicho cair.
      this.fall = Math.min(1, this.fall + dt / FALL_TIME);
      const t = this.fall * this.fall * (3 - 2 * this.fall);
      this.mesh.rotation.z = -(Math.PI / 2) * t;
      this.body.animate(dt, 0, false);
      return;
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 1e-2) this.targetYaw = Math.atan2(this.vel.x, this.vel.z);
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));   // menor arco
    // Mais devagar que a do bot (×8): ovelha que gira no eixo instantaneamente
    // parece um cursor, e o corpo é comprido — o giro é visível.
    this.yaw += d * Math.min(1, dt * 6);
    this.mesh.rotation.y = this.yaw;

    this.body.animate(dt, speed, this.brain.state === 'pastando');
  }

  /**
   * Levou pancada. `deQuem` = { x, z } de quem bateu, para ela fugir na direção
   * contrária; sem ele, foge para um lado sorteado.
   * @returns {boolean} true se morreu AGORA (e não se já estava morta).
   */
  hurt(dano = 1, deQuem) {
    if (this.dead) return false;
    this.health -= dano;
    if (this.dead) {
      // Morta, para de andar na hora. O tombo é do mesh; o corpo fica onde caiu.
      this.vel.x = 0;
      this.vel.z = 0;
      return true;
    }
    // O cérebro só soube da posição no último pensamento (até 0,3 s atrás), e
    // 0,3 s a 4,2 blocos/s é mais de um bloco de erro na direção da fuga. Um
    // tick de tempo zero refresca a posição sem mexer em timer nenhum.
    this.brain.update(0, { x: this.pos.x, z: this.pos.z, playerDist: Infinity });
    const de = deQuem || this.pos;
    this.brain.panic(de.x, de.z);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rebanho: nascimento, física, recolhimento e mira
// ---------------------------------------------------------------------------

// Folga da caixa de mira. A AABB da física é um quadrado de 0,9 porque ela gira
// com o bicho e um retângulo comprido em Z mentiria assim que a ovelha virasse
// de lado. Só que o corpo tem 1,15 de comprimento e sobra da AABB nas pontas —
// mirar a cabeça de uma ovelha que está bem debaixo do cursor e não acertar nada
// é o tipo de coisa que faz o jogador achar que a picareta está quebrada. A
// caixa da mira leva essa folga; a da física, não.
const AIM_PAD = 0.25;

export class SheepManager {
  constructor(scene, world, count = 6, center = { x: 8.5, z: 8.5 }, rng = Math.random) {
    this.scene = scene;
    this.world = world;
    this.count = count;
    this.rng = rng;
    this.sheep = [];
    for (let i = 0; i < count; i++) this._nascer(center);
  }

  update(dt, playerPos) {
    const vivas = [];
    for (const s of this.sheep) {
      // Duas saídas de cena: ficou longe demais (renasce perto, mais adiante) e
      // acabou de tombar. Recolher por distância é o que mantém o rebanho ao
      // redor do jogador sem espalhar ovelhas pelo mundo inteiro à medida que
      // ele caminha — cada uma custa física e seis materiais de canvas.
      const longe = Math.hypot(playerPos.x - s.pos.x, playerPos.z - s.pos.z) > DESPAWN_DIST;
      if (longe || (s.dead && !s.tombando)) {
        this.scene.remove(s.mesh);
        continue;
      }

      s.sinceThink += dt;
      s.thinkTimer -= dt;
      if (s.thinkTimer <= 0) {
        s.think(s.sinceThink, playerPos);
        s.sinceThink = 0;
        s.thinkTimer += THINK_INTERVAL;
      }

      s.steer(this.world, playerPos);
      // A morta continua na física só para assentar no chão se caiu no ar; ela
      // já não anda (steer zerou o horizontal) e ninguém mais esbarra nela.
      moveEntity(this.world, s, dt);
      s.syncMesh(dt);
      vivas.push(s);
    }
    this.sheep = vivas;

    // Repovoamento: no máximo uma por frame. O terreno bom pode não existir
    // por perto (mar, deserto, pedra), e insistir até achar travaria o frame
    // justamente onde o mundo é mais hostil.
    if (this.sheep.length < this.count) this._nascer(playerPos);
  }

  /**
   * Ovelha mais próxima no raio: interseção raio × AABB pelo método das lajes
   * (slab). Matemática pura de propósito — um THREE.Raycaster aqui exigiria
   * geometria real e mediria o mesh animado, e a cabeça abaixada para pastar
   * mudaria o que o jogador consegue acertar.
   * @returns {{ sheep: Sheep, t: number } | null}
   */
  raycast(origin, dir, maxDist) {
    let melhor = null;
    for (const s of this.sheep) {
      if (s.dead) continue;   // cadáver não é alvo: renderia vida infinita
      const half = s.width / 2 + AIM_PAD;
      const min = [s.pos.x - half, s.pos.y, s.pos.z - half];
      const max = [s.pos.x + half, s.pos.y + s.height, s.pos.z + half];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];

      let tmin = -Infinity;
      let tmax = Infinity;
      let acerta = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          // Raio paralelo a este par de faces: ou já está entre elas, ou nunca
          // vai estar. Dividir por zero aqui daria ±Infinity e, num eixo em que
          // a origem está fora, um NaN que passa por acerto.
          if (o[a] < min[a] || o[a] > max[a]) { acerta = false; break; }
          continue;
        }
        const t1 = (min[a] - o[a]) / d[a];
        const t2 = (max[a] - o[a]) / d[a];
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      }
      if (!acerta || tmax < Math.max(tmin, 0)) continue;

      // Origem dentro da caixa (o jogador colado na ovelha): tmin é negativo e
      // o acerto vale, à distância zero.
      const t = Math.max(tmin, 0);
      if (t > maxDist) continue;
      if (!melhor || t < melhor.t) melhor = { sheep: s, t };
    }
    return melhor;
  }

  _nascer(perto) {
    const sitio = this._sitio(perto);
    if (!sitio) return null;
    const s = new Sheep(sitio, this.rng);
    this.sheep.push(s);
    this.scene.add(s.mesh);
    return s;
  }

  // Um lugar de grama, num anel em volta de `perto`. Devolve null depois de
  // SPAWN_TRIES tentativas — quem chamou tenta de novo no frame seguinte.
  _sitio(perto) {
    const w = this.world;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const ang = this.rng() * Math.PI * 2;
      const dist = SPAWN_MIN + this.rng() * (SPAWN_MAX - SPAWN_MIN);
      const bx = Math.floor(perto.x + Math.cos(ang) * dist);
      const bz = Math.floor(perto.z + Math.sin(ang) * dist);

      // `surfaceHeight` devolve a altura do CHÃO (ignora água) e o topo de uma
      // árvore conta como chão — daí a exigência de ser GRASS, que descarta de
      // uma vez copa de árvore, areia de praia, pedra de montanha e o fundo de
      // um lago (que é grama, mas com água por cima, pega no teste seguinte).
      const surf = w.surfaceHeight(bx, bz);
      if (surf < 0) continue;
      if (w.getBlock(bx, surf, bz) !== Blocks.GRASS) continue;

      // As duas células que a AABB de 1,3 ocupa de pé têm de estar livres.
      // Livre inclui planta: capim e flor é onde a ovelha deve estar mesmo.
      let livre = true;
      for (let dy = 1; dy <= 2; dy++) {
        if (w.isSolid(bx, surf + dy, bz) || w.isLiquid(bx, surf + dy, bz)) {
          livre = false;
          break;
        }
      }
      if (!livre) continue;

      return { x: bx + 0.5, y: surf + 1, z: bz + 0.5 };
    }
    return null;
  }
}
