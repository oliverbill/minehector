// Céu e clima. Cor não se testa sem olho, mas o relógio, a alternância dos
// períodos e o comportamento das partículas são aritmética — e é neles que
// mora o que o jogador percebe: quanto dura cada período, se a noite escurece
// mesmo, e se a neve cai mais devagar que a chuva.

import { test, assert, assertEqual } from './tiny-test.mjs';
import { Sky, PERIODO, DIA, MANHA, TARDE, NOITE } from '../js/render/sky.js';
import { Weather, LIMPO, CHUVA, NEVE } from '../js/render/weather.js';

// Cena de mentira: só precisa aceitar add() e guardar background/fog.
const cenaFalsa = () => ({
  children: [],
  add(o) { this.children.push(o); },
  fog: { color: null },
  background: null,
});
const luzFalsa = () => ({ color: null, intensity: 0, position: { set() {} } });

function ceu(t0 = 0) {
  const scene = cenaFalsa();
  const sun = luzFalsa();
  const ambient = luzFalsa();
  return { scene, sun, ambient, sky: new Sky(scene, sun, ambient, t0) };
}

const AQUI = { x: 0, y: 40, z: 0 };

test('o dia tem três períodos de 15 minutos', () => {
  assertEqual(PERIODO, 15 * 60, 'período em segundos');
  assertEqual(DIA, PERIODO * 3, 'o dia são os três períodos');

  const { sky } = ceu(0);
  assertEqual(sky.phase, MANHA, 'o ciclo não começa de manhã');
  sky.update(PERIODO, AQUI);
  assertEqual(sky.phase, TARDE, 'depois da manhã não veio a tarde');
  sky.update(PERIODO, AQUI);
  assertEqual(sky.phase, NOITE, 'depois da tarde não veio a noite');
  sky.update(PERIODO, AQUI);
  assertEqual(sky.phase, MANHA, 'o dia não deu a volta');
});

test('o relógio diz quanto falta para o próximo período', () => {
  const { sky } = ceu(0);
  assertEqual(Math.round(sky.untilNext), PERIODO, 'no início do período falta ele inteiro');
  sky.update(PERIODO / 3, AQUI);
  assertEqual(Math.round(sky.untilNext), Math.round(PERIODO * 2 / 3), 'a conta não andou');
});

test('a noite escurece de verdade, e o dia clareia de volta', () => {
  const dia = ceu(PERIODO * 0.5);      // meio da manhã
  dia.sky.update(0.016, AQUI);
  const luzDia = dia.sun.intensity + dia.ambient.intensity;

  const noite = ceu(PERIODO * 2.4);    // meio da noite
  noite.sky.update(0.016, AQUI);
  const luzNoite = noite.sun.intensity + noite.ambient.intensity;

  assert(luzNoite < luzDia * 0.6, `noite (${luzNoite.toFixed(2)}) perto do dia (${luzDia.toFixed(2)})`);
  assert(luzNoite > 0.15, 'a noite ficou preta: o jogo tem de continuar jogável');
});

test('as estrelas só acendem de noite, e o sol se põe', () => {
  const dia = ceu(PERIODO * 0.5);
  dia.sky.update(0.016, AQUI);
  assert(dia.sky.estrelas.material.opacity < 0.05, 'estrela acesa de dia');
  assert(dia.sky.sol.visible, 'sol sumido de dia');

  const noite = ceu(PERIODO * 2.4);
  noite.sky.update(0.016, AQUI);
  assert(noite.sky.estrelas.material.opacity > 0.4, 'noite sem estrelas');
  assert(!noite.sky.sol.visible, 'o sol continua no céu de noite');
  assert(noite.sky.lua.visible, 'noite sem lua');
});

test('o céu acompanha o jogador (senão o mundo tem uma borda)', () => {
  const { sky } = ceu(0);
  sky.update(0.016, { x: 500, y: 40, z: -300 });
  assertEqual(sky.grupo.position.x, 500, 'o céu ficou para trás em x');
  assertEqual(sky.grupo.position.z, -300, 'o céu ficou para trás em z');
});

// --- clima -----------------------------------------------------------------

function clima(sorteios = []) {
  let i = 0;
  const rnd = () => (sorteios.length ? sorteios[i++ % sorteios.length] : 0.5);
  const scene = cenaFalsa();
  return new Weather(scene, rnd);
}

test('o tempo começa limpo e alterna com tempo aberto no meio', () => {
  const w = clima([0.1]);   // sorteio baixo: prefere chuva
  assertEqual(w.kind, LIMPO, 'não começou limpo');
  assertEqual(w.pontos.visible, false, 'partícula caindo com tempo limpo');

  w.update(1e6, AQUI);
  assertEqual(w.kind, CHUVA, 'do limpo não veio chuva');
  w.update(1e6, AQUI);
  // Nunca chuva -> neve direto: parece defeito, não clima.
  assertEqual(w.kind, LIMPO, 'emendou um tempo fechado no outro');
});

test('chuva e neve se distinguem: a neve cai devagar e é maior', () => {
  const w = clima();
  w.set(CHUVA);
  const chuva = { tam: w.material.size, opa: w.material.opacity };
  const quedaChuva = alturaCaidaEm(w, 0.5);

  w.set(NEVE);
  const quedaNeve = alturaCaidaEm(w, 0.5);

  assert(quedaNeve < quedaChuva / 3, `neve caiu ${quedaNeve.toFixed(2)}, chuva ${quedaChuva.toFixed(2)}`);
  assert(w.material.size > chuva.tam, 'floco não é maior que gota');
  assert(w.darkness > 0, 'nevando e o céu não muda');
});

// Quanto uma partícula desce em `t` segundos, medida na própria geometria.
function alturaCaidaEm(w, t) {
  const arr = w.pontos.geometry.attributes.position.array;
  arr[1] = 10;                       // põe a primeira gota no meio da caixa
  w.update(t, AQUI);
  return 10 - arr[1];
}

test('tempo fechado escurece o céu, tempo limpo não', () => {
  const w = clima();
  assertEqual(w.darkness, 0, 'tempo limpo escurecendo o céu');
  w.set(CHUVA);
  assert(w.darkness > 0.3, 'chuva quase não escurece');

  // E o escurecimento chega ao céu de verdade.
  const { sky, sun } = ceu(PERIODO * 0.5);
  sky.update(0.016, AQUI, 0);
  const claro = sun.intensity;
  sky.update(0.016, AQUI, w.darkness);
  assert(sun.intensity < claro, 'o céu ignorou a chuva');
});

test('as partículas seguem o jogador e reciclam ao chegar embaixo', () => {
  const w = clima();
  w.set(CHUVA);
  w.update(0.016, { x: 120, y: 30, z: -40 });
  assertEqual(w.pontos.position.x, 120, 'a chuva ficou para trás');

  const arr = w.pontos.geometry.attributes.position.array;
  arr[1] = -100;                     // gota bem abaixo do chão da caixa
  w.update(0.016, AQUI);
  assert(arr[1] > 0, 'gota que caiu não voltou para o alto');
});
