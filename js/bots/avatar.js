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

const U = 1.8 / 32;   // altura da AABB do bot dividida pelas unidades do boneco
const PX = 8;         // pixels de textura por unidade (meio-U ainda é nítido)

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

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const shade = ([r, g, b], d) => [clamp255(r + d), clamp255(g + d), clamp255(b + d)];
const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

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
};

// ---------------------------------------------------------------------------
// Pintura em coordenadas de U (meio-U também vale)
// ---------------------------------------------------------------------------

function surface(wu, hu) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wu * PX);
  canvas.height = Math.round(hu * PX);
  const ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = css(color);
    ctx.fillRect(Math.round(x * PX), Math.round(y * PX), Math.round(w * PX), Math.round(h * PX));
  };
  // Granulado por meio-U: sem isto o tecido fica liso demais e o boneco parece
  // um brinquedo de plástico ao lado dos blocos, que são todos texturados.
  const grain = (x, y, w, h, color, amp, rnd) => {
    for (let gy = 0; gy < h * 2; gy++) {
      for (let gx = 0; gx < w * 2; gx++) {
        rect(x + gx / 2, y + gy / 2, 0.5, 0.5, shade(color, (rnd() - 0.5) * amp));
      }
    }
  };
  return { canvas, rect, grain };
}

function material(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return new THREE.MeshLambertMaterial({ map: tex });
}

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
      rect(3.75, 5, 0.5, 1, shade(skin, -24));        // nariz
      rect(3.25, 6.25, 1.5, 0.5, shade(skin, -52));   // boca
      rect(0, 4, 0.5, 4, shade(skin, -20));           // sombra dos lados do rosto
      rect(7.5, 4, 0.5, 4, shade(skin, -20));
    } else {
      grain(0, 0, 8, 8, skin, 10, rnd);
      grain(0, 0, 8, 2.5, hair, 18, rnd);
      rect(face === RIGHT ? 0 : 7, 2.5, 1, 1.5, hair);
      rect(3, 4, 0.75, 1.5, shade(skin, -30));        // orelha
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
    } else if (isFront) {
      rect(w - 2.5, 4, 1.5, 2, trim);                                         // bolso
    }
    if (isFront) {
      rect(2.5, 0, 3, 1, shade(shirt, 28));                                   // gola
      rect(3.75, 1, 0.5, 3, trim);                                            // abotoamento
    }
    grain(0, 9.5, w, 1, shade(pants, -40), 8, rnd);                           // cinto
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
    return material(s.canvas);
  });
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

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
    pattern: Math.floor(rnd() * 3),
    hoodie: false,
    shorts: false,
    longSleeve: false,
    glove: null,
    sock: null,
    nameTag: true,
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

  return {
    group,
    /**
     * @param {number} dt      segundos desde o último frame
     * @param {number} speed   velocidade horizontal em blocos/s
     * @param {boolean} onGround
     * @param {number} [pitch] mira em radianos; a cabeça acompanha em vez de
     *                         ficar olhando em volta sozinha (usado pelo jogador)
     */
    animate(dt, speed, onGround, pitch) {
      clock += dt;
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
