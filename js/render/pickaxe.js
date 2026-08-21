// Picareta: cabo de madeira e cabeça de ferro, pintados em pixel art por código,
// como o atlas dos blocos e a skin dos bots. Nenhuma imagem externa, nenhuma
// dependência nova.
//
// Por que ela mora aqui e não em `js/bots/avatar.js`: o martelo dos bots é uma
// peça do boneco — nasce escondido dentro do braço direito e só existe durante a
// obra. A picareta é do jogador, e o jogador a vê de dois jeitos muito
// diferentes: pendurada no braço do avatar (terceira pessoa) e pendurada na
// própria câmera (primeira pessoa). Uma peça com duas casas dessas não cabe
// dentro do construtor do avatar sem virar um parâmetro que ninguém entende.
//
// As ferramentas de pintura — `surface`, `material` e `shade` — vêm de
// `js/render/pixelart.js`, o mesmo pincel do boneco. Isso não é economia de
// linhas: é o que garante que a ferramenta e a mão que a segura pareçam do mesmo
// mundo. Duas cópias de `surface()` divergiriam no primeiro ajuste de granulado,
// e a picareta ficaria lisa ao lado de um boneco texturado — o erro clássico de
// ferramenta colada.
//
// Unidade: bloco. Ao contrário do avatar (que mede em `U`, trinta e dois avos da
// AABB), aqui a medida natural é o bloco, porque a picareta é comparada com o
// bloco que ela quebra, não com o corpo que a segura. Com `escala = 1` o
// conjunto tem 0,965 bloco de altura por 0,568 de vão de cabeça; `createHandPickaxe()` a encolhe para caber
// no canto do campo de visão.
//
// Sobre a névoa: a cena tem `THREE.Fog` linear (js/render/renderer.js) começando
// em 60% do raio de visão — 38,4 blocos no desktop, 28,8 no celular. A picareta
// de primeira pessoa é filha da câmera e vive a menos de um bloco do olho, ou
// seja, muito antes do início da névoa: nenhum material especial, nenhum
// `fog: false`, nenhuma segunda cena. Vale registrar porque a tentação de criar
// uma cena de overlay para a arma é o primeiro reflexo de quem já apanhou disso
// em engine com fog exponencial — aqui a névoa é linear e simplesmente não a
// alcança.

import * as THREE from 'three';
import { surface, material, shade } from './pixelart.js';

// ---------------------------------------------------------------------------
// Medidas, em blocos, com escala = 1
// ---------------------------------------------------------------------------

// A empunhadura é a ORIGEM do grupo: quem pendura a picareta (o pivô do braço do
// avatar, ou a câmera) posiciona a mão, não a ferramenta. Se a origem fosse o
// centro geométrico, cada ponto de suspensão precisaria de um deslocamento
// próprio, e os dois iam escorregar em direções diferentes no primeiro ajuste.
const CABO_TOPO = 0.12;     // o cabo sobe um pouco acima da mão, até entrar na cabeça
const CABO_BASE = -0.72;    // e desce por -Y, que é o contrapeso da silhueta
const CABO_SECAO = 0.10;    // seção quadrada; mais fino que isto some contra o terreno

const CABECA_Y = 0.17;      // centro da cabeça, logo acima do punho
const CABECA_ALT = 0.15;
const CABECA_PROF = 0.12;
const BARRA_LARG = 0.26;    // trecho reto do meio; as pontas continuam a partir daqui

// As proporções acima foram medidas NA TELA, não no papel. A primeira versão
// tinha cabo de 0,075 e cabeça de 0,645 de vão: no canto do campo de visão, uma
// barra cinzenta comprida e fina atravessada por um palito lê "cano", e o
// jogador não vê ferramenta nenhuma. Cabeça mais curta e mais alta, cabo mais
// grosso, pontas mais viradas — a silhueta passa a ser reconhecível no tamanho
// em que ela de fato aparece, que é o único tamanho que importa.

// Ângulo das pontas. Sem elas a cabeça é um tijolo atravessado no cabo, e de
// longe a silhueta lê "martelo" — que é exatamente a ferramenta do vizinho neste
// jogo. O que faz uma picareta ser picareta é a ponta: duas caixas menores
// afinando nas extremidades e viradas levemente para +Z, de modo que o gume
// aponte para onde o jogador olha. É a única diferença de forma entre as duas
// ferramentas, e é ela que o olho usa.
const PONTA_GIRO = 0.55;    // rad, para +Z; mais que isso e a cabeça vira gancho

const MADEIRA = [128, 88, 48];
const COURO = [92, 58, 34];
const FERRO = [104, 108, 118];

// Altura total resultante: de CABO_BASE ao topo da cabeça (CABECA_Y + metade da
// altura da cabeça) = 0,965 bloco. É o número que aparece na doc de
// `createPickaxe` e o que o teste de caixa envolvente confere.

// ---------------------------------------------------------------------------
// Pintura
// ---------------------------------------------------------------------------

// Aleatoriedade determinística, como no avatar: a mesma picareta em toda sessão
// e em toda máquina. O martelo dos bots resolve isto passando `() => 0.5` para o
// granulado, o que na prática desliga o granulado e devolve uma cor chapada.
// Aqui a picareta é vista de perto — a 0,5 bloco do olho em primeira pessoa —, e
// chapada ela denuncia na hora que é uma caixa pintada. Então tem ruído de
// verdade, só que sempre o mesmo.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Face lateral do cabo. O veio vertical importa mais que a cor: madeira sem veio
// fica igual a couro escuro, e o cabo é a metade da ferramenta que aparece
// inteira na tela.
function caboLateral(rnd) {
  const s = surface(2, 12);
  s.grain(0, 0, 2, 12, MADEIRA, 22, rnd);
  // Duas riscas de veio, uma escura e uma clara, quebradas por meio-U para não
  // virarem trilho de trem descendo o cabo.
  for (let y = 0; y < 12; y += 0.5) {
    s.rect(0.25 + (rnd() < 0.5 ? 0 : 0.25), y, 0.25, 0.5, shade(MADEIRA, -26));
    s.rect(1.25 + (rnd() < 0.5 ? 0 : 0.25), y, 0.25, 0.5, shade(MADEIRA, 18));
  }
  // Nó da madeira: um ponto escuro com halo. Um só, para não virar textura de
  // dálmata.
  s.rect(0.75, 7, 0.5, 0.75, shade(MADEIRA, -34));
  s.rect(0.75, 7.25, 0.25, 0.25, shade(MADEIRA, -58));
  // Amarração de couro logo abaixo da cabeça (a imagem tem o topo em y = 0, como
  // no avatar): é o que diz onde a mão vai, e o que impede a leitura de "cabo de
  // vassoura enfiado num tijolo".
  s.grain(0, 0.5, 2, 2.5, COURO, 16, rnd);
  s.rect(0, 0.5, 2, 0.35, shade(COURO, 30));      // borda de cima do enrolado
  s.rect(0, 2.65, 2, 0.35, shade(COURO, -34));    // e a sombra onde ele acaba
  for (let y = 1; y < 2.6; y += 0.5) {
    s.rect(0, y, 2, 0.25, shade(COURO, -18));     // voltas da tira
  }
  // Ponta de baixo mais escura: é a que encosta no chão e fica na sombra do
  // corpo em terceira pessoa.
  s.rect(0, 11.25, 2, 0.75, shade(MADEIRA, -28));
  return material(s.canvas);
}

function caboTopoBase(rnd, claro) {
  const s = surface(2, 2);
  s.grain(0, 0, 2, 2, shade(MADEIRA, claro ? 10 : -38), 12, rnd);
  // Anéis de tronco na seção cortada: dois retângulos concêntricos bastam.
  s.rect(0.5, 0.5, 1, 1, shade(MADEIRA, claro ? -18 : -52));
  return material(s.canvas);
}

// Ordem das faces de uma BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
function caboFaces(rnd) {
  return [
    caboLateral(rnd), caboLateral(rnd),
    caboTopoBase(rnd, true), caboTopoBase(rnd, false),
    caboLateral(rnd), caboLateral(rnd),
  ];
}

/**
 * Um painel de ferro. `gume` desenha a faixa clara do fio na borda pedida
 * ('esq' | 'dir' | 'nao'), que é o que faz a ponta parecer afiada em vez de
 * cortada com serra.
 */
function painelFerro(wu, hu, rnd, gume = 'nao', brilho = true) {
  const s = surface(wu, hu);
  s.grain(0, 0, wu, hu, FERRO, 18, rnd);
  const faixa = Math.max(0.5, hu * 0.22);
  if (brilho) {
    // Luz na aresta de cima e sombra embaixo: o ferro só lê como metal quando
    // tem os dois. Com um só, vira pedra cinzenta.
    s.rect(0, 0, wu, faixa, shade(FERRO, 40));
    s.rect(0, faixa, wu, faixa * 0.4, shade(FERRO, 16));
    s.rect(0, hu - faixa, wu, faixa, shade(FERRO, -44));
  }
  // Marcas de forja: riscos curtos, sempre nos mesmos lugares.
  for (let i = 0; i < Math.max(1, Math.floor(wu / 2)); i++) {
    const x = 0.5 + i * 1.5;
    if (x + 0.5 <= wu) s.rect(x, hu * 0.45, 0.5, 0.25, shade(FERRO, -22));
  }
  if (gume !== 'nao') {
    const x = gume === 'dir' ? wu - 0.5 : 0;
    s.rect(x, 0, 0.5, hu, shade(FERRO, 66));
    s.rect(gume === 'dir' ? wu - 0.75 : 0.5, 0, 0.25, hu, shade(FERRO, 30));
  }
  return material(s.canvas);
}

// Um bloco de ferro completo: o gume só é pintado na face externa (a que o
// jogador vê quando a ponta entra no bloco) e nas duas faces largas.
function ferroFaces(wu, hu, du, rnd, gumeLado = 0) {
  const largo = (g) => painelFerro(wu, hu, rnd, g);
  return [
    painelFerro(du, hu, rnd, gumeLado > 0 ? 'dir' : 'nao'),   // +X
    painelFerro(du, hu, rnd, gumeLado < 0 ? 'esq' : 'nao'),   // -X
    painelFerro(wu, du, rnd, 'nao', false),                   // +Y (topo já é a luz)
    painelFerro(wu, du, rnd, 'nao', false),                   // -Y
    largo(gumeLado > 0 ? 'dir' : gumeLado < 0 ? 'esq' : 'nao'), // +Z
    largo(gumeLado > 0 ? 'esq' : gumeLado < 0 ? 'dir' : 'nao'), // -Z (espelhado)
  ];
}

function bloco(w, h, d, faces) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faces);
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/**
 * Picareta de pedra/ferro, pintada em pixel art como o resto do jogo.
 * O grupo devolvido tem a EMPUNHADURA na origem: o cabo desce por -Y e a cabeça
 * fica acima da mão. `escala` multiplica tudo (1 = 0,965 bloco de altura total).
 */
export function createPickaxe(escala = 1) {
  const g = new THREE.Group();
  const rnd = rng(0x9e3779b1);

  const cabo = bloco(
    CABO_SECAO, CABO_TOPO - CABO_BASE, CABO_SECAO, caboFaces(rnd),
  );
  cabo.position.y = (CABO_TOPO + CABO_BASE) / 2;
  g.add(cabo);

  const barra = bloco(
    BARRA_LARG, CABECA_ALT, CABECA_PROF, ferroFaces(4, 1.5, 1.5, rnd, 0),
  );
  barra.position.y = CABECA_Y;
  g.add(barra);

  // Cada ponta é um braço articulado na borda da barra: um trecho médio e uma
  // ponta fina. Modelar como grupo (e não como caixa solta já girada) mantém o
  // giro num lugar só — mexer em PONTA_GIRO reposiciona os dois segmentos
  // juntos, sem trigonometria espalhada pelo arquivo.
  for (const lado of [1, -1]) {
    const braco = new THREE.Group();
    braco.position.set(lado * (BARRA_LARG / 2), CABECA_Y, 0);
    // Sinal invertido porque girar +X em torno de +Y leva o ponto para -Z; as
    // duas pontas têm de sair para o MESMO lado (a frente), não uma para cada.
    braco.rotation.y = -lado * PONTA_GIRO;

    const meia = bloco(0.10, 0.125, 0.11, ferroFaces(2, 1.5, 1.5, rnd, 0));
    meia.position.x = lado * 0.05;

    const ponta = bloco(0.075, 0.08, 0.075, ferroFaces(1.5, 1.5, 1.5, rnd, lado));
    ponta.position.x = lado * 0.12;

    braco.add(meia, ponta);
    g.add(braco);
  }

  g.scale.setScalar(escala);
  return g;
}

// ---------------------------------------------------------------------------
// A picareta de primeira pessoa
// ---------------------------------------------------------------------------

// Encolhida para caber no canto sem tapar a mira. O número foi medido na tela,
// não deduzido: a 0,62 a cabeça de ferro atravessava um terço da largura da
// imagem e o canto inferior direito virava uma barra cinzenta: parecia um cano
// apoiado na câmera. A 0,46 a ferramenta ocupa cerca de um quinto da largura,
// que é a proporção em que ela se lê como "na minha mão" e não como "flutuando
// na frente do cenário".
const ESCALA_MAO = 0.46;

// Pose de repouso, em espaço de câmera (-Z é para dentro da tela). Canto
// inferior direito: é onde a mão de quem joga espera encontrá-la, e é o canto
// que menos disputa com a HUD (hotbar embaixo ao centro, mira no meio).
const POSE = {
  x: 0.34, y: -0.22, z: -0.55,
  rx: -0.15,   // a cabeça tomba de leve para dentro da tela
  ry: 0.40,    // três quartos: mostra a face larga do ferro E a ponta da frente
  rz: 1.00,    // o cabo cai para o canto de baixo e a cabeça sobe à esquerda dele
};

// O `rz` é a diferença entre ferramenta e enfeite. Com o cabo quase a prumo, a
// mão fica no meio da borda de baixo e a cabeça cresce para o centro da tela,
// tapando justamente o bloco que se quer quebrar. Inclinado a ~57°, o cabo sai
// pela quina inferior direita (onde a mão de quem joga espera encontrá-lo) e a
// cabeça sobe para o lado, ao alcance da vista e fora do caminho da mira.

// Ritmo da martelada, igual ao MARTELADAS_POR_SEGUNDO do avatar.js. Não é
// importado porque lá não é exportado — mas é o mesmo número de propósito: em
// terceira pessoa o braço do boneco e a picareta na mão dele batem juntos, e
// dois ritmos parecidos-mas-diferentes produzem um batimento que o olho pega na
// hora.
const MARTELADAS_POR_SEGUNDO = 1.6;

// Fração do ciclo gasta na descida. Menos da metade porque a martelada real é
// assimétrica: desce rápido (o peso do ferro ajuda) e volta devagar (o braço
// levanta contra a gravidade). Com 0,34, a descida leva 0,21 s e a volta 0,41 s.
const DESCIDA = 0.34;

// Curva do golpe: 0 na pose de repouso, 1 no fundo da martelada. As duas metades
// são meio cosseno, então a derivada é zero nas emendas — sem isso o retorno dá
// um estalo no fim de cada ciclo, que é o defeito que mais se nota numa
// animação em loop.
function arcoGolpe(u) {
  if (u < DESCIDA) return 0.5 - 0.5 * Math.cos((u / DESCIDA) * Math.PI);
  return 0.5 + 0.5 * Math.cos(((u - DESCIDA) / (1 - DESCIDA)) * Math.PI);
}

const TAU = Math.PI * 2;

/**
 * A picareta que o jogador vê em primeira pessoa, já posicionada para ser
 * pendurada NA CÂMERA (`camera.add(mao.group)`).
 *
 * Distância ao olho: a pose põe a empunhadura a 0,55 bloco, e o ponto da
 * ferramenta que mais se aproxima da câmera fica a 0,440 bloco — medido pela
 * caixa envolvente em espaço de câmera, ao longo de um ciclo inteiro de
 * martelada e de um ciclo inteiro de respiração. São mais de quatro vezes o
 * `near` de 0,1 da câmera (js/render/renderer.js), então nada é recortado pelo
 * near plane e não foi preciso mexer na câmera nem criar uma segunda passagem de
 * render. A margem é essa, e mexer em POSE.z ou em ESCALA_MAO sem refazer a
 * conta é o caminho curto para a picareta começar a ser comida pelo canto de
 * baixo — por isso a medida virou teste (tests/view.test.mjs).
 *
 * Devolve { group, animate(dt, batendo) }.
 */
export function createHandPickaxe() {
  const group = createPickaxe(ESCALA_MAO);
  group.position.set(POSE.x, POSE.y, POSE.z);
  group.rotation.set(POSE.rx, POSE.ry, POSE.rz);

  // Fases guardadas aqui dentro, e avançadas por `dt`. Nada de Date.now(): o
  // relógio de parede faz a animação pular quando a aba volta do segundo plano,
  // e faz o teste depender da hora em que roda.
  let respira = 0;   // sobe e desce do peito
  let balanco = 0;   // deriva lenta lateral, fora de fase com a respiração
  let fase = 0;      // posição dentro da martelada, em ciclos [0, 1)
  let mistura = 0;   // 0 = repouso puro, 1 = martelando

  return {
    group,
    animate(dt, batendo = false) {
      // Aba escondida devolve dt gigante ou NaN; deixar passar contamina as
      // fases para sempre, e daí em diante toda posição vira NaN.
      if (!(dt > 0)) dt = 0;
      else if (dt > 0.1) dt = 0.1;

      // Começa a martelada do zero quando ela estava mesmo apagada. Se a fase
      // seguisse correndo no repouso, o primeiro golpe podia nascer no meio do
      // arco e sair pela metade.
      if (batendo && mistura < 0.02) fase = 0;

      // Interpolação exponencial entre as duas poses. É o que impede o solavanco
      // quando `batendo` alterna: em vez de trocar de pose num frame, a base
      // desliza de uma para a outra — e um golpe interrompido no meio termina o
      // arco enquanto desaparece.
      //
      // Entrar pode ser rápido porque a fase acabou de ser zerada e o arco
      // começa em zero: a mistura sobe atrás de um deslocamento que ainda não
      // existe. Sair é que precisa de rampa longa, porque soltar o botão no
      // fundo da martelada tem de trazer a ferramenta de volta, não teletransportá-la.
      const taxa = batendo ? 12 : 6;
      mistura += ((batendo ? 1 : 0) - mistura) * Math.min(1, dt * taxa);

      if (batendo || mistura > 0.01) {
        fase = (fase + dt * MARTELADAS_POR_SEGUNDO) % 1;
      }

      // Wrap em 2π: sem isto as fases crescem sem parar e, depois de algumas
      // horas de jogo, o seno perde resolução e o balanço fica granulado.
      respira = (respira + dt * 1.75) % TAU;
      balanco = (balanco + dt * 0.9) % TAU;

      const golpe = mistura * arcoGolpe(fase);
      const calma = 1 - mistura;   // a respiração some enquanto se martela

      // Repouso: poucos centímetros e poucos graus. Amplitude maior parece
      // enjoo; amplitude zero parece captura de tela.
      const sobeDesce = Math.sin(respira) * 0.018 * calma;
      const vaiVem = Math.sin(balanco) * 0.011 * calma;

      group.position.set(
        POSE.x + vaiVem - 0.035 * golpe,
        POSE.y + sobeDesce - 0.150 * golpe,
        POSE.z - 0.090 * golpe,            // e para dentro da tela, contra o bloco
      );
      group.rotation.set(
        POSE.rx - 0.85 * golpe + Math.sin(respira + 0.9) * 0.045 * calma,
        POSE.ry + 0.18 * golpe,
        POSE.rz - 0.30 * golpe + Math.sin(balanco + 1.7) * 0.030 * calma,
      );
    },
  };
}
