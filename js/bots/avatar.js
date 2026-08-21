// Avatar dos bots: corpo humanoide segmentado (cabeça, tronco, dois braços, duas
// pernas) com skin em pixel art desenhada por código, como o atlas dos blocos.
// Nenhuma imagem externa, nenhuma dependência nova.
//
// Por que segmentado e não duas caixas: um boneco de duas caixas não tem frente.
// De lado ou de costas ele é o mesmo borrão colorido, e o jogador não sabe se o
// bot está vindo, indo ou parado. Com cabeça, membros e um rosto no +Z, a
// direção fica legível a 10 blocos — que é a distância em que a IA decide seguir.
//
// Unidade: `U`. O boneco tem 32 U de altura para casar com os 1,8 blocos da AABB
// (pernas 12 + tronco 12 + cabeça 8). Toda medida abaixo está em U, para as
// proporções não escorregarem quando a altura mudar.

import * as THREE from 'three';
import { createPickaxe } from '../render/pickaxe.js';
import { clamp255, shade, surface, material } from '../render/pixelart.js';

const U = 1.8 / 32;   // altura da AABB do bot dividida pelas unidades do boneco

// Ritmo da martelada. Perto do ritmo de assentamento da obra (9 blocos/s é
// rápido demais para o olho seguir), mas devagar o bastante para se ler como
// braço batendo, e não como vibração.
const MARTELADAS_POR_SEGUNDO = 1.6;

// Ordem das faces numa BoxGeometry do Three: +X, -X, +Y, -Y, +Z, -Z.
// O mesh do bot é girado por atan2(vel.x, vel.z), então +Z é a frente: é onde
// vai o rosto.
const RIGHT = 0, LEFT = 1, TOP = 2, BOTTOM = 3, FRONT = 4, BACK = 5;

// ---------------------------------------------------------------------------
// Cor e aleatoriedade determinísticas
// ---------------------------------------------------------------------------

// Hash de string estável: o mesmo nome dá sempre o mesmo boneco, entre sessões e
// entre máquinas. O resto do projeto também evita Math.random por isso.
function hashName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFrom(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function mix(a, b, t) {
  return [
    clamp255(a[0] + (b[0] - a[0]) * t),
    clamp255(a[1] + (b[1] - a[1]) * t),
    clamp255(a[2] + (b[2] - a[2]) * t),
  ];
}

function fromHex(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

// Detalhe visível sobre qualquer cor de roupa. Escurecer funciona em tecido
// claro, mas num moletom preto um detalhe mais escuro vira buraco — o bolso
// canguru sumia e o peito ficava com uma mancha. Em tecido escuro, clareia.
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const detail = (c, d = 26) => shade(c, luma(c) < 90 ? d + 8 : -d);

// Tons de pele e cabelo pensados para serem distinguíveis entre si de longe, e
// não para retratar ninguém em particular.
const SKINS = [
  [242, 205, 175], [226, 178, 140], [198, 145, 108],
  [160, 110, 78], [116, 78, 54], [80, 54, 40],
];
const HAIRS = [
  [40, 30, 26], [78, 48, 30], [120, 74, 38],
  [186, 148, 74], [96, 96, 104], [150, 60, 48],
];

// O boneco do jogador. Ao contrário dos bots, este não é sorteado: é sempre o
// mesmo, tirado de uma foto do Heitor — cabelo escuro curto, moletom preto de
// zíper, bermuda clara, tênis escuros e as luvas de boxe vermelhas. O que um
// boneco de voxel consegue mostrar é roupa e silhueta, e é nisso que ele é
// reconhecível; rosto, neste tamanho, são quatro pixels.
export const HEITOR = {
  skin: [214, 168, 132],
  hair: [34, 27, 25],
  shirt: [28, 28, 31],      // moletom preto
  pants: [232, 223, 198],   // bermuda creme
  shoe: [46, 44, 46],
  sock: [200, 46, 52],
  glove: [198, 38, 40],     // luva de boxe vermelha
  eye: [62, 46, 38],
  gaze: 0,
  hoodie: true,
  shorts: true,
  longSleeve: true,
  nameTag: false,           // é você: nome flutuando na cara atrapalha
  tool: 'picareta',         // e a picareta não sai da mão dele
};

// As funções de pintura (`surface`, `material`, `shade`) moram em
// js/render/pixelart.js: o boneco, a picareta que ele segura e as ovelhas são
// pintados pelo mesmo pincel, e uma segunda cópia divergiria no primeiro ajuste
// de granulado.

// ---------------------------------------------------------------------------
// As peças
// ---------------------------------------------------------------------------

// Cabeça 8×8×8. O rosto vai na face +Z; o cabelo cobre topo, costas e laterais.
function headFaces(look, rnd) {
  const { skin, hair } = look;
  const dark = shade(hair, -22);
  const faces = [];

  for (const face of [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK]) {
    const s = surface(8, 8);
    const { rect, grain } = s;

    if (face === TOP) {
      grain(0, 0, 8, 8, hair, 20, rnd);
      rect(3.5, 0, 1, 8, shade(hair, 14));            // risca do cabelo
    } else if (face === BOTTOM) {
      grain(0, 0, 8, 8, shade(skin, -34), 10, rnd);   // queixo/pescoço na sombra
    } else if (face === BACK) {
      grain(0, 0, 8, 8, skin, 10, rnd);
      grain(0, 0, 8, 5.5, hair, 18, rnd);
      rect(0, 5.5, 8, 0.5, dark);                     // franja da nuca
    } else if (face === FRONT) {
      grain(0, 0, 8, 8, skin, 10, rnd);
      // Franja irregular: uma faixa reta de cabelo vira capacete. Meio-U de
      // variação por coluna já basta para ler como cabelo.
      for (let c = 0; c < 16; c++) {
        rect(c / 2, 0, 0.5, 1.5 + (rnd() < 0.5 ? 0 : 0.5), shade(hair, (rnd() - 0.5) * 18));
      }
      rect(0, 1.5, 0.5, 2.5, hair);                   // costeletas emoldurando o rosto
      rect(7.5, 1.5, 0.5, 2.5, hair);
      rect(0.5, 0, 0.5, 1, shade(hair, -14));
      rect(7, 0, 0.5, 1, shade(hair, -14));
      // Olhos pequenos: a esta distância, olho grande vira máscara de mergulho.
      rect(1.75, 3.4, 0.5, 0.5, dark);                // sobrancelhas
      rect(2.25, 3.25, 1, 0.5, dark);
      rect(4.75, 3.25, 1, 0.5, dark);
      rect(5.75, 3.4, 0.5, 0.5, dark);
      rect(2, 4, 1.5, 0.75, [248, 248, 248]);
      rect(4.5, 4, 1.5, 0.75, [248, 248, 248]);
      rect(2.5 + look.gaze * 0.5, 4, 0.5, 0.75, look.eye);
      rect(5 + look.gaze * 0.5, 4, 0.5, 0.75, look.eye);
      // Brilho no olho: um pixel claro na íris. É o que separa um rosto de dois
      // pontos pretos — de perto, em terceira pessoa, o olho passa a ter foco.
      rect(2.5 + look.gaze * 0.5, 4, 0.25, 0.25, [236, 240, 248]);
      rect(5 + look.gaze * 0.5, 4, 0.25, 0.25, [236, 240, 248]);
      // Nariz com narina e ponta iluminada, em vez de um risco só.
      rect(3.75, 5, 0.5, 1, shade(skin, -24));
      rect(3.6, 5.75, 0.25, 0.25, shade(skin, -46));
      rect(4.25, 5.75, 0.25, 0.25, shade(skin, -46));
      rect(3.75, 4.9, 0.5, 0.25, shade(skin, 22));
      // Boca com lábio: linha escura e um tom mais claro embaixo.
      rect(3.25, 6.25, 1.5, 0.35, shade(skin, -58));
      rect(3.5, 6.6, 1, 0.25, shade(skin, -18));
      rect(0, 4, 0.5, 4, shade(skin, -20));           // sombra dos lados do rosto
      rect(7.5, 4, 0.5, 4, shade(skin, -20));
      rect(2.75, 7.25, 2.5, 0.5, shade(skin, -14));   // queixo
      if (look.freckles) {                            // sardas: separa os rostos
        for (const [fx, fy] of [[2.5, 5.4], [3, 5.9], [5, 5.4], [5.5, 5.9], [2.75, 6.1]]) {
          rect(fx, fy, 0.25, 0.25, shade(skin, -30));
        }
      }
    } else {
      grain(0, 0, 8, 8, skin, 10, rnd);
      grain(0, 0, 8, 2.5, hair, 18, rnd);
      rect(face === RIGHT ? 0 : 7, 2.5, 1, 1.5, hair);
      // Orelha com concha, e costeleta descendo do cabelo.
      rect(3, 4, 0.75, 1.5, shade(skin, -30));
      rect(3.25, 4.4, 0.35, 0.7, shade(skin, -52));
      rect(face === RIGHT ? 0.5 : 6.5, 2.5, 1, 1.75, shade(hair, -10));
    }
    faces.push(material(s.canvas));
  }
  return faces;
}

// Tronco 8×12×4. Padrão da roupa varia por bot: só a matiz não separa três
// bonecos vistos contra terreno colorido.
function torsoFaces(look, rnd) {
  const { shirt, pants } = look;
  const trim = shade(shirt, -34);
  const faces = [];

  const dressShirt = (s, w, isFront) => {
    const { rect, grain } = s;
    grain(0, 0, w, 9.5, shirt, 16, rnd);
    // Moletom de zíper: o zíper desce inteiro pela frente, com o bolso canguru
    // logo abaixo. É o que separa um moletom de uma camiseta escura.
    if (look.hoodie) {
      grain(0, 9.5, w, 2.5, shirt, 14, rnd);              // o moletom passa do quadril
      rect(0, 0, w, 1.2, detail(shirt, 18));              // barra do capuz no peito
      if (isFront) {
        rect(w / 2 - 0.25, 0, 0.5, 9.5, shade(shirt, 46));   // zíper
        for (let y = 0.5; y < 9.5; y += 0.5) rect(w / 2 - 0.25, y, 0.5, 0.25, shade(shirt, 18));
        rect(w / 2 - 0.4, 1.2, 0.8, 0.6, [214, 214, 218]);   // cursor do zíper
        rect(1, 5.5, w - 2, 2, detail(shirt, 20));           // bolso canguru
        rect(1, 5.5, w - 2, 0.35, detail(shirt, 30));        // boca do bolso
        rect(w - 2.5, 7.6, 1.2, 0.4, [226, 226, 230]);       // estampa miúda no peito
      }
      rect(0, 11.6, w, 0.4, detail(shirt, 14));           // punho da barra
      return;
    }
    if (look.pattern === 0) {
      for (let y = 1; y < 9; y += 2) grain(0, y, w, 1, trim, 10, rnd);        // listras
    } else if (look.pattern === 1) {
      grain(w / 2 - 0.75, 0, 1.5, 9.5, trim, 10, rnd);                        // faixa central
    } else if (look.pattern === 3) {
      // Xadrez: faixas nos dois sentidos, e o cruzamento mais escuro que cada
      // uma. É o que faz o tecido parecer tecido — a trama muda de tom onde os
      // fios se cruzam, e sem isso vira uma grade desenhada por cima.
      const claro = shade(shirt, 18);
      for (let y = 0; y < 9.5; y += 2) rect(0, y, w, 1, claro);
      for (let x = 0; x < w; x += 2) rect(x, 0, 1, 9.5, mix(shirt, trim, 0.55));
      for (let y = 0; y < 9.5; y += 2) {
        for (let x = 0; x < w; x += 2) rect(x, y, 1, 1, shade(trim, -12));
      }
    } else if (isFront) {
      rect(w - 2.5, 4, 1.5, 2, trim);                                         // bolso
      rect(w - 2.5, 4, 1.5, 0.3, shade(shirt, 24));                           // aba do bolso
    }
    if (isFront) {
      // Camisa aberta sobre uma camiseta clara, como na referência: a faixa do
      // meio é a peça de baixo aparecendo, com a gola em V por cima.
      if (look.open) {
        const baixo = look.undershirt || [222, 220, 212];
        grain(w / 2 - 1.25, 0, 2.5, 9.5, baixo, 10, rnd);
        rect(w / 2 - 1.5, 0, 0.5, 9.5, shade(shirt, -46));
        rect(w / 2 + 1, 0, 0.5, 9.5, shade(shirt, -46));
        rect(w / 2 - 0.25, 1.5, 0.5, 6, shade(baixo, -28));   // vinco da camiseta
      }
      rect(2.5, 0, 3, 1, shade(shirt, 28));                                   // gola
      rect(2.25, 0, 0.5, 1.6, shade(shirt, 34));                              // pontas da gola
      rect(5.25, 0, 0.5, 1.6, shade(shirt, 34));
      if (!look.open) {
        rect(3.75, 1, 0.5, 3, trim);                                          // abotoamento
        for (let y = 1.5; y < 8.5; y += 2) rect(3.8, y, 0.4, 0.4, shade(shirt, 44)); // botões
      }
    }
    grain(0, 9.5, w, 1, shade(pants, -40), 8, rnd);                           // cinto
    if (isFront) {
      rect(w / 2 - 0.75, 9.55, 1.5, 0.9, [206, 176, 96]);                     // fivela
      rect(w / 2 - 0.4, 9.8, 0.8, 0.4, shade(pants, -50));
    }
    grain(0, 10.5, w, 1.5, pants, 12, rnd);
  };

  for (const face of [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK]) {
    if (face === TOP) {
      const s = surface(8, 4);
      s.grain(0, 0, 8, 4, shirt, 14, rnd);
      s.rect(2.5, 1, 3, 2, shade(look.skin, -10));    // buraco do pescoço
      faces.push(material(s.canvas));
    } else if (face === BOTTOM) {
      const s = surface(8, 4);
      s.grain(0, 0, 8, 4, shade(look.pants, -20), 10, rnd);
      faces.push(material(s.canvas));
    } else if (face === FRONT || face === BACK) {
      const s = surface(8, 12);
      dressShirt(s, 8, face === FRONT);
      faces.push(material(s.canvas));
    } else {
      const s = surface(4, 12);
      dressShirt(s, 4, false);
      faces.push(material(s.canvas));
    }
  }
  return faces;
}

// Braço 4×12×4: manga, pele, mão. Perna 4×12×4: calça e sapato.
function armFaces(look, rnd) {
  const { skin, shirt, glove } = look;
  // Luva de boxe: a mão some dentro dela e o punho ganha um enfaixado claro. Não
  // dá para engordar a caixa (a geometria é a mesma dos bots), então o que
  // marca a luva é ela ocupar quase um terço do braço e ter o brilho no dorso.
  const handLen = glove ? 3.5 : 1.5;
  // Manga comprida vai até onde a mão começa: no moletom fechado não sobra
  // antebraço à mostra, e uma faixa de pele no meio do braço preto denunciava
  // logo que a manga era curta.
  const sleeveLen = look.longSleeve ? 12 - handLen : 5;
  return [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK].map((face) => {
    if (face === TOP) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, shirt, 14, rnd);
      return material(s.canvas);
    }
    if (face === BOTTOM) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, glove ? shade(glove, -26) : shade(skin, -20), 10, rnd);
      return material(s.canvas);
    }
    const s = surface(4, 12);
    s.grain(0, 0, 4, sleeveLen, shirt, 16, rnd);                    // manga
    s.grain(0, sleeveLen, 4, 12 - sleeveLen - handLen, skin, 12, rnd); // antebraço
    s.rect(0, sleeveLen - 0.25, 4, 0.35, detail(shirt, 22));        // barra da manga
    if (glove) {
      s.grain(0, 12 - handLen, 4, handLen, glove, 14, rnd);
      s.rect(0, 12 - handLen, 4, 0.5, [236, 232, 226]);      // punho enfaixado
      s.rect(0.5, 12 - handLen + 1, 3, 0.5, shade(glove, 34)); // brilho do couro
      s.rect(0, 11.5, 4, 0.5, shade(glove, -34));            // costura da ponta
    } else {
      s.grain(0, 10.5, 4, 1.5, shade(skin, -18), 10, rnd);   // mão
    }
    return material(s.canvas);
  });
}

function legFaces(look, rnd) {
  const { pants, shoe, skin, shorts, sock } = look;
  // Bermuda: a calça para na coxa e o resto da perna é pele. Sem isto o boneco
  // de bermuda fica igual ao de calça, que é a diferença mais visível de longe.
  const pantsLen = shorts ? 4 : 9.5;
  return [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK].map((face) => {
    if (face === TOP) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, pants, 12, rnd);
      return material(s.canvas);
    }
    if (face === BOTTOM) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, shade(shoe, -30), 8, rnd);    // sola
      return material(s.canvas);
    }
    const s = surface(4, 12);
    s.grain(0, 0, 4, pantsLen, pants, 14, rnd);
    if (shorts) {
      s.grain(0, pantsLen, 4, 9.5 - pantsLen, skin, 12, rnd);
      s.rect(0, pantsLen - 0.35, 4, 0.35, shade(pants, -30));   // barra da bermuda
      if (sock) s.grain(0, 8.75, 4, 0.75, sock, 10, rnd);       // meia aparecendo
    } else {
      s.rect(0, 4.5, 4, 0.35, shade(pants, -34));               // vinco do joelho
    }
    s.grain(0, 9.5, 4, 2.5, shoe, 10, rnd);             // sapato
    s.rect(0, 9.5, 4, 0.35, shade(shoe, 26));           // cano do sapato
    // Solado claro e cadarços cruzados: o sapato deixa de ser um bloco escuro.
    s.rect(0, 11.5, 4, 0.5, shade(shoe, 40));
    if (face === FRONT) {
      for (let i = 0; i < 3; i++) {
        s.rect(1, 10 + i * 0.5, 2, 0.25, shade(shoe, 52));
      }
    }
    return material(s.canvas);
  });
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

// Martelo de pedreiro: cabo de madeira e cabeça de ferro, na mão direita. Só
// aparece durante a obra — ferramenta na mão o tempo todo vira parte do corpo e
// deixa de dizer "estou trabalhando", que é justamente o que ele existe para
// dizer.
function hammer() {
  const g = new THREE.Group();

  const madeira = [128, 88, 48];
  const ferro = [104, 108, 118];

  const cabo = surface(2, 10);
  cabo.grain(0, 0, 2, 10, madeira, 18, () => 0.5);
  cabo.rect(0, 0, 2, 1, shade(madeira, -30));
  const caboMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * U, 7 * U, 1.2 * U),
    material(cabo.canvas),
  );
  caboMesh.position.y = -3 * U;

  const cabeca = surface(4, 4);
  cabeca.grain(0, 0, 4, 4, ferro, 16, () => 0.5);
  cabeca.rect(0, 0, 4, 0.5, shade(ferro, 34));
  cabeca.rect(0, 3.5, 4, 0.5, shade(ferro, -34));
  const cabecaMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.4 * U, 2 * U, 3.4 * U),
    material(cabeca.canvas),
  );
  cabecaMesh.position.y = 0.6 * U;

  g.add(caboMesh, cabecaMesh);
  // Na ponta do braço, apontando para a frente como quem segura uma ferramenta.
  g.position.set(0, -11 * U, 1.5 * U);
  g.rotation.x = -Math.PI / 2.2;
  g.visible = false;
  return g;
}

// A picareta do jogador, na mesma mão em que o bot leva o martelo — mas esta
// não some nunca. Ferramenta permanente diz outra coisa que a do bot: o martelo
// aparece para dizer "estou trabalhando AGORA", e a picareta está lá para dizer
// "é com isto que eu quebro o mundo", que é verdade a cada clique.
//
// Três decisões de pose, todas por causa do que se vê em terceira pessoa:
//   - escala 0,62, e não 1: uma picareta de 0,95 bloco num boneco de 1,8 é uma
//     marreta de circo, e a ponta arrastaria no chão com o braço parado;
//   - girada 45° em torno de Y: com a cabeça atravessada no eixo X, a ponta de
//     dentro entrava no tronco a cada passada. Na diagonal ela passa à frente
//     do peito, e de quebra a picareta continua legível tanto de trás (que é a
//     câmera padrão) quanto de lado;
//   - quase a prumo, com um tombo pequeno para fora e para a frente: é a pose de
//     quem CARREGA a ferramenta, com a cabeça na altura do punho e o cabo
//     descendo ao lado da perna. Inclinada para trás ela desaparecia atrás do
//     corpo — e a câmera padrão de terceira pessoa é justamente a de trás.
const PICARETA_ESCALA = 0.62;

function playerPickaxe() {
  const g = createPickaxe(PICARETA_ESCALA);
  g.position.set(1.6 * U, -11 * U, 1.2 * U);
  g.rotation.set(-0.25, Math.PI / 4, -0.30);
  return g;
}

function box(wu, hu, du, faces, hangFromTop) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(wu * U, hu * U, du * U), faces);
  // Membro pendurado pelo topo: o pivô fica no ombro/quadril, então a caixa
  // desce meia altura. É o que faz o giro parecer articulação e não hélice.
  if (hangFromTop) mesh.position.y = (-hu / 2) * U;
  return mesh;
}

function pivotAt(x, y, z, child) {
  const g = new THREE.Group();
  g.position.set(x * U, y * U, z * U);
  g.add(child);
  return g;
}

function nameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
  );
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.15;
  return sprite;
}

/**
 * Boneco de um bot. `color` é a cor da camisa (o roster já distingue os bots por
 * ela); o resto — pele, cabelo, calça, sapato, padrão da roupa — sai do nome,
 * de forma determinística.
 *
 * `overrides` fixa peças desse visual, para um boneco que não é sorteado: é como
 * o jogador ganha sempre a mesma roupa em vez de uma tirada do hash do nome.
 * Campos extras aceitos: `hoodie`, `shorts`, `glove`, `sock`, `nameTag`.
 *
 * Devolve { group, animate(dt, speed, onGround, pitch) }. O group tem origem nos
 * pés, como a `pos` da física.
 */
export function createAvatar(name, color, overrides = {}) {
  const rnd = rngFrom(hashName(name));
  const shirt = fromHex(color);
  const look = {
    skin: SKINS[Math.floor(rnd() * SKINS.length)],
    hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
    shirt,
    pants: mix(fromHex(0x3b4363), shirt, 0.18 + rnd() * 0.12),
    shoe: shade(fromHex(0x2e2a28), Math.floor(rnd() * 20)),
    eye: rnd() < 0.5 ? [58, 48, 42] : [46, 74, 96],
    gaze: (Math.floor(rnd() * 3) - 1) * 0.4,   // olhar levemente para um lado
    pattern: Math.floor(rnd() * 4),            // 3 = xadrez
    open: rnd() < 0.5,                         // camisa aberta sobre camiseta
    undershirt: [222, 220, 212],
    freckles: rnd() < 0.4,
    hoodie: false,
    shorts: false,
    longSleeve: false,
    glove: null,
    sock: null,
    nameTag: true,
    tool: 'martelo',   // 'picareta' = ferramenta permanente (o jogador)
    ...overrides,
  };

  const group = new THREE.Group();

  const head = pivotAt(0, 28, 0, box(8, 8, 8, headFaces(look, rnd), false));
  const torso = box(8, 12, 4, torsoFaces(look, rnd), false);
  torso.position.y = 18 * U;

  const armMats = armFaces(look, rnd);
  const legMats = legFaces(look, rnd);
  const armL = pivotAt(-6, 23.5, 0, box(4, 12, 4, armMats, true));
  const armR = pivotAt(6, 23.5, 0, box(4, 12, 4, armMats, true));
  const legL = pivotAt(-2, 12, 0, box(4, 12, 4, legMats, true));
  const legR = pivotAt(2, 12, 0, box(4, 12, 4, legMats, true));

  // A ferramenta pendura no pivô do braço direito: gira junto com o ombro, como
  // ferramenta segurada, em vez de flutuar ao lado do corpo. Quem tem picareta
  // anda com ela na mão; quem tem martelo só o saca durante a obra.
  const sempreNaMao = look.tool === 'picareta';
  const ferramenta = sempreNaMao ? playerPickaxe() : hammer();
  ferramenta.visible = sempreNaMao;
  armR.add(ferramenta);

  group.add(torso, head, armL, armR, legL, legR);
  if (look.nameTag) group.add(nameSprite(name));

  // Capuz caído nas costas: uma caixa rasa atrás do pescoço. Preso ao tronco e
  // não à cabeça — capuz que gira junto com o rosto vira chapéu.
  if (look.hoodie) {
    const hoodMats = [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK].map(() => {
      const s = surface(8, 4);
      s.grain(0, 0, 8, 4, shade(look.shirt, -16), 14, rnd);
      s.rect(0, 0, 8, 0.5, shade(look.shirt, 22));
      return material(s.canvas);
    });
    const hood = box(8, 5, 3, hoodMats, false);
    hood.position.set(0, 25 * U, -3 * U);
    group.add(hood);
  }

  let phase = rnd() * Math.PI * 2;  // bots não marcham em sincronia
  let swing = 0;
  let clock = rnd() * 10;
  let marteladas = rnd();           // nem martelam em sincronia
  let batendo = false;

  return {
    group,
    /**
     * Está batendo? Antes isto era "o martelo está visível", o que deixou de
     * responder à pergunta no dia em que uma ferramenta passou a ficar na mão o
     * tempo todo — o jogador estaria eternamente construindo.
     */
    get building() { return batendo; },
    /**
     * @param {number} dt      segundos desde o último frame
     * @param {number} speed   velocidade horizontal em blocos/s
     * @param {boolean} onGround
     * @param {number} [pitch] mira em radianos; a cabeça acompanha em vez de
     *                         ficar olhando em volta sozinha (usado pelo jogador)
     * @param {boolean} [building] está assentando bloco: martelo na mão,
     *                         martelada no braço e o corpo agachando junto
     */
    animate(dt, speed, onGround, pitch, building = false) {
      clock += dt;

      // Trabalhando: o corpo desce e sobe no ritmo da martelada, e é essa
      // subida e descida que faz o boneco parecer estar assentando o tijolo, e
      // não parado ao lado dele. Termina cedo para o resto da pose (cabeça,
      // pernas, respiração) continuar valendo por baixo.
      batendo = building;
      ferramenta.visible = sempreNaMao || building;
      if (building) {
        marteladas += dt * MARTELADAS_POR_SEGUNDO;
        const arco = Math.sin(marteladas * Math.PI * 2);
        const golpe = Math.max(0, arco);          // sobe devagar, desce batendo
        armR.rotation.x = -2.0 + golpe * 2.3;
        armR.rotation.z = -0.10;
        armL.rotation.x = -0.5 - golpe * 0.35;    // a outra mão segura o bloco
        armL.rotation.z = 0.22;
        legL.rotation.x = 0.12;
        legR.rotation.x = -0.12;
        // Agacha no golpe: tronco e cabeça descem, as pernas ficam plantadas.
        const agacho = golpe * 1.1;
        torso.position.y = (18 - agacho) * U;
        head.position.y = (28 - agacho) * U;
        armL.position.y = (23.5 - agacho) * U;
        armR.position.y = (23.5 - agacho) * U;
        head.rotation.x = 0.34;                   // olhando para a obra
        head.rotation.y = 0;
        return;
      }
      head.position.y = 28 * U;
      armL.position.y = 23.5 * U;
      armR.position.y = 23.5 * U;
      // A passada acompanha a velocidade; parado, o balanço morre em vez de
      // congelar no meio do passo.
      phase += dt * (2.5 + speed * 1.9);
      const wanted = Math.min(0.85, speed * 0.24);
      swing += (wanted - swing) * Math.min(1, dt * 9);

      const s = Math.sin(phase) * swing;
      legL.rotation.x = s;
      legR.rotation.x = -s;
      armL.rotation.x = -s * 0.85;
      armR.rotation.x = s * 0.85;
      // Braços levemente abertos, senão atravessam o tronco na volta do arco.
      armL.rotation.z = 0.06 + swing * 0.10;
      armR.rotation.z = -0.06 - swing * 0.10;

      if (!onGround) {
        // No ar: braços para cima. Ajuda a ler o pulo de longe, quando o bot
        // sobe um degrau de terreno.
        armL.rotation.x = -2.1;
        armR.rotation.x = -2.1;
      }

      // Parado, o boneco respira e olha em volta — sem isto ele vira estátua.
      const idle = 1 - Math.min(1, swing / 0.3);
      if (typeof pitch === 'number') {
        // Quem tem dono não olha para os lados sozinho: a cabeça segue a mira.
        // O sinal é invertido porque o rosto é a face +Z, e girar +X a empurra
        // para baixo.
        head.rotation.y = 0;
        head.rotation.x = -pitch * 0.7;
      } else {
        head.rotation.y = Math.sin(clock * 0.7) * 0.28 * idle;
        head.rotation.x = Math.sin(clock * 0.5 + 1.2) * 0.10 * idle;
      }
      torso.position.y = (18 + Math.sin(clock * 1.6) * 0.10 * idle) * U;
    },
  };
}
