// Pintura em pixel art por código — o jeito único de texturar tudo que não é
// bloco: o boneco dos bots e do jogador, a picareta na mão dele e as ovelhas.
// Nenhuma imagem externa, como no atlas dos blocos.
//
// Isto morava dentro de `js/bots/avatar.js`, que foi onde nasceu. Ficou lá
// enquanto o boneco era o único a se pintar assim; quando a picareta e as
// ovelhas passaram a usar as mesmas três funções, manter a casa no avatar criou
// um **ciclo de import**: avatar → pickaxe → avatar. Módulos ES aguentam o
// ciclo enquanto ninguém usa o outro lado no corpo do módulo, e é justamente por
// isso que ele é traiçoeiro — funciona até o dia em que alguém acrescenta uma
// chamada no topo do arquivo e recebe um `undefined` sem explicação nenhuma. Uma
// terceira casa, que não importa ninguém, desfaz o ciclo de uma vez.
//
// A unidade aqui é abstrata de propósito. O avatar mede em `U` (trinta e dois
// avos da altura do bot), a picareta e a ovelha medem em bloco: o que estas
// funções pedem é "quantas unidades de textura", e cada chamador diz qual é a
// unidade dele.

import * as THREE from 'three';

const PX = 8;   // pixels de textura por unidade (meio-U ainda é nítido)

export const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Clareia (delta > 0) ou escurece (delta < 0) uma cor [r, g, b]. */
export const shade = ([r, g, b], d) => [clamp255(r + d), clamp255(g + d), clamp255(b + d)];

export const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

/**
 * Uma superfície de `wu` × `hu` unidades para pintar uma face.
 * Devolve `{ canvas, rect, grain }` — `rect` pinta em coordenadas de unidade
 * (meio-U também vale) e `grain` preenche uma área com ruído por meio-U.
 */
export function surface(wu, hu) {
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

/** Material Lambert com a textura do canvas, em NearestFilter (pixel art). */
export function material(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return new THREE.MeshLambertMaterial({ map: tex });
}
