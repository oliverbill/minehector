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
  const { skin, shirt } = look;
  return [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK].map((face) => {
    if (face === TOP) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, shirt, 14, rnd);
      return material(s.canvas);
    }
    if (face === BOTTOM) {
      const s = surface(4, 4);
      s.grain(0, 0, 4, 4, shade(skin, -20), 10, rnd);   // palma da mão
      return material(s.canvas);
    }
    const s = surface(4, 12);
    s.grain(0, 0, 4, 5, shirt, 16, rnd);                // manga
    s.grain(0, 5, 4, 5.5, skin, 12, rnd);               // antebraço
    s.grain(0, 10.5, 4, 1.5, shade(skin, -18), 10, rnd); // mão
    s.rect(0, 4.75, 4, 0.35, shade(shirt, -40));        // barra da manga
    return material(s.canvas);
  });
}

function legFaces(look, rnd) {
  const { pants, shoe } = look;
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
    s.grain(0, 0, 4, 9.5, pants, 14, rnd);
    s.rect(0, 4.5, 4, 0.35, shade(pants, -34));         // vinco do joelho
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
 * Devolve { group, animate(dt, speed, onGround) }. O group tem origem nos pés,
 * como a `pos` da física.
 */
export function createAvatar(name, color) {
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

  group.add(torso, head, armL, armR, legL, legR, nameSprite(name));

  let phase = rnd() * Math.PI * 2;  // bots não marcham em sincronia
  let swing = 0;
  let clock = rnd() * 10;

  return {
    group,
    /**
     * @param {number} dt      segundos desde o último frame
     * @param {number} speed   velocidade horizontal em blocos/s
     * @param {boolean} onGround
     */
    animate(dt, speed, onGround) {
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
      head.rotation.y = Math.sin(clock * 0.7) * 0.28 * idle;
      head.rotation.x = Math.sin(clock * 0.5 + 1.2) * 0.10 * idle;
      torso.position.y = (18 + Math.sin(clock * 1.6) * 0.10 * idle) * U;
    },
  };
}
