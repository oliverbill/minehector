// A aldeia: onde cada construção cabe, quem já construiu o quê, e a obra em
// andamento de um bot.
//
// A obra é progressiva de propósito. Uma casa que aparece inteira num frame é
// indistinguível de um bug de geração; vendo o bot assentar bloco a bloco, o
// jogador entende que aquilo ali é obra de alguém.

import { planStructure, STRUCTURE_KINDS, footprint } from '../world/structures.js';
import { Blocks, Owner } from '../constants.js';

// A aldeia é uma lista de pendências, não um sorteio: uma de cada, e acabou.
// Assim o jogador vê as SEIS — cabana, palafita, torre, poço, roça e sobrado —
// em vez de três torres e dois poços, que era o que o sorteio uniforme dava.
export const MAX_STRUCTURES = STRUCTURE_KINDS.length;
export const SITE_MIN_DIST = 4;     // blocos entre construções (é uma vila, não um condomínio)
export const SPAWN_CLEAR = 7;       // raio livre em torno do spawn do jogador
// A aldeia inteira cabe neste raio em volta do spawn. Sem o teto, cada bot
// construía onde estivesse quando deu vontade — e como eles vagueiam, as casas
// nasciam a 40 ou 50 blocos, longe demais para quem só quer ver a obra acontecer.
export const VILLAGE_RADIUS = 16;
// Teto de folga para um tipo teimoso. O sobrado é a maior planta e exige um
// retângulo grande e plano; dentro de 16 blocos ele quase nunca achava lugar e
// simplesmente não era construído. Cada recusa afrouxa o raio DELE um pouco,
// até este limite — melhor um sobrado a 24 blocos do que sobrado nenhum.
export const VILLAGE_RADIUS_MAX = 34;
// Recusas que um tipo acumula antes de ganhar 1 bloco de folga. Não é enfeite:
// com afrouxamento a cada recusa, o raio estourava em um minuto de jogo (três
// bots pedindo obra a cada poucos segundos, e uma recusa conta para todos os
// tipos pendentes) e a aldeia inteira nascia a 26-33 blocos. Medido em cinco
// seeds: com 4, saem as seis com no máximo uma além de 25 blocos.
const RECUSAS_POR_BLOCO = 4;
export const BLOCKS_PER_SECOND = 9; // ritmo de assentamento
const FOUNDATION_DEPTH = 10;        // até onde o alicerce desce atrás de apoio
const ADIAMENTOS_MAX = 40;          // voltas que um bloco espera quem está no caminho
// Muitas tentativas de propósito: o raio da aldeia é apertado, e cada recusa
// (desnível, vizinha perto demais, coisa do jogador) come um candidato. Com 40 a
// aldeia parava na metade das casas por falta de sorteio, não por falta de lugar.
// É um laço de aritmética que roda só quando um bot decide construir.
const SITE_TRIES = 60;
// Poço e roça são pequenos, e pequeno cabe em quase todo terreno. Ficam por
// último na fila dos pendentes: à sorte, o poço saía primeiro quase sempre, e a
// primeira coisa que o jogador via era um buraco no chão em vez de uma casa.
const PEQUENAS = new Set(['poco', 'roca']);

const MAX_SLOPE = 2;                // desnível tolerado no terreno do sítio

/** A célula [c, c+1)³ toca a AABB de alguma entidade? */
function occupiedBy(occupants, cx, cy, cz) {
  for (const e of occupants) {
    if (!e || !e.pos) continue;
    const half = (e.width || 0.6) / 2;
    const h = e.height || 1.8;
    if (cx + 1 > e.pos.x - half && cx < e.pos.x + half
      && cy + 1 > e.pos.y && cy < e.pos.y + h
      && cz + 1 > e.pos.z - half && cz < e.pos.z + half) return true;
  }
  return false;
}

/** Obra em andamento: uma fila de blocos que o bot assenta aos poucos. */
export class BuildJob {
  constructor(world, origin, plan) {
    this.world = world;
    this.origin = origin;           // { x, y, z } — y é o piso (local y = 0)
    this.plan = plan;
    this.queue = plan.blocks.map(([x, y, z, id]) => [x, y, z, id]);
    this.credit = 0;

    // Alicerce: o terreno raramente é uma mesa. Sem preencher do chão até o
    // piso, a construção fica pairando com um degrau impossível na entrada.
    //
    // A varredura desce célula a célula até achar apoio — e não usa
    // surfaceHeight, que numa coluna com árvore devolve o topo da copa. Com a
    // copa como referência, o alicerce começava acima do piso, não preenchia
    // nada, e a obra limpava a árvore deixando um vão embaixo.
    const fp = footprint(plan);
    const base = [];
    for (let z = fp.z0; z <= fp.z1; z++) {
      for (let x = fp.x0; x <= fp.x1; x++) {
        const wx = origin.x + x;
        const wz = origin.z + z;
        for (let y = origin.y - 1; y > origin.y - 1 - FOUNDATION_DEPTH; y--) {
          if (world.isSolid(wx, y, wz)) break;
          base.push([x, y - origin.y, z, Blocks.STONE]);
        }
      }
    }
    this.queue = [...base, ...this.queue];
    this.total = this.queue.length;
  }

  /**
   * Tira quem está no caminho e o põe de pé no primeiro lugar acima onde ele
   * CABE — duas células livres, que é a altura de um corpo.
   *
   * Subir um bloco e pronto não serve: se houver bloco logo acima (e numa casa
   * costuma haver: piso, viga, telhado), o empurrão emparedava a pessoa dentro
   * da parede recém-erguida. `wy` conta como ocupado porque o bloco que motivou
   * o empurrão é assentado logo em seguida.
   */
  _shoveOut(e, wx, wy, wz) {
    const alt = Math.ceil(e.height || 1.8);
    for (let y = wy + 1; y <= wy + 8; y++) {
      let cabe = true;
      for (let i = 0; i < alt; i++) {
        if (this.world.isSolid(wx, y + i, wz)) { cabe = false; break; }
      }
      if (cabe) { e.pos.y = y; return; }
    }
    e.pos.y = wy + 1;   // teto de tentativas: melhor por cima do que dentro
  }

  get done() { return this.queue.length === 0; }
  get progress() { return this.total === 0 ? 1 : 1 - this.queue.length / this.total; }

  /**
   * Ponto onde o bot fica enquanto trabalha: à frente da porta e FORA de toda a
   * planta, não apenas fora da porta.
   *
   * Ficar a 1,5 bloco da soleira parecia bastar, mas varanda, beiral e o primeiro
   * degrau da escada avançam para além dela — e o pedreiro acabava plantado em
   * cima de uma célula que ele mesmo precisava assentar. O bloco era adiado, ele
   * não saía do lugar, e a casa ficava eternamente em obra.
   */
  get standPoint() {
    const door = this.plan.door;
    const dx = door ? door.x : Math.floor(this.plan.w / 2);
    const fp = footprint(this.plan);
    return { x: this.origin.x + dx + 0.5, z: this.origin.z + fp.z0 - 1.5 };
  }

  /**
   * Assenta o que couber em `dt` segundos.
   *
   * `occupants` são as entidades vivas (bots e jogador). Bloco que cairia em
   * cima de alguém volta para o fim da fila em vez de ser assentado: sem isto a
   * obra emparedava quem estivesse na soleira — inclusive o próprio pedreiro,
   * que fica parado ali o tempo todo.
   */
  step(dt, occupants = []) {
    this.credit += dt * BLOCKS_PER_SECOND;
    let tentativas = this.queue.length;
    while (this.credit >= 1 && this.queue.length && tentativas > 0) {
      this.credit -= 1;
      tentativas -= 1;
      const item = this.queue.shift();
      const [x, y, z, id] = item;
      const wx = this.origin.x + x;
      const wy = this.origin.y + y;
      const wz = this.origin.z + z;
      if (id !== Blocks.AIR && occupiedBy(occupants, wx, wy, wz)) {
        // Adiar é a cortesia; adiar para sempre é a obra parada. Depois de
        // ADIAMENTOS_MAX voltas, o bloco é assentado e quem estava ali sobe para
        // cima dele. Uma pessoa parada na soleira não pode congelar uma casa.
        item[4] = (item[4] || 0) + 1;
        if (item[4] <= ADIAMENTOS_MAX) {
          this.queue.push(item);   // depois, quando quem está ali tiver saído
          continue;
        }
        for (const e of occupants) {
          if (e && e.pos && occupiedBy([e], wx, wy, wz)) this._shoveOut(e, wx, wy, wz);
        }
      }
      // Célula do jogador é intocável, e ao contrário do caso acima não adianta
      // esperar: ele não vai sair dali. O bloco é descartado e a obra segue com
      // um furo — melhor uma casa remendada do que uma obra que nunca acaba.
      this.world.setBlock(wx, wy, wz, id, Owner.BOT);
    }
    return this.done;
  }
}

export class Village {
  constructor(world, spawn, rnd = Math.random) {
    this.world = world;
    this.spawn = spawn;
    this.rnd = rnd;
    this.structures = [];           // { kind, origin, door: {x,z}, bounds, job }
    this._fails = new Map();        // tipo -> quantas vezes não achou lugar
  }

  get full() { return this.structures.length >= MAX_STRUCTURES; }

  /** As construções que já ficaram prontas. */
  get built() {
    return this.structures.filter((s) => s.job.done);
  }

  /**
   * Construção mais próxima de (x,z), com a distância. Obra em andamento tem
   * preferência sobre casa pronta: o que vale a pena andar até lá para ver é o
   * bloco sendo assentado, não a parede parada.
   *
   * Existe para a HUD apontar o caminho. Cinco casas a quinze blocos dentro de
   * uma floresta são invisíveis do spawn, e "não estou vendo as construções" foi
   * queixa antes de ser hipótese.
   */
  nearest(x, z) {
    let melhor = null;
    for (const s of this.structures) {
      const d = Math.hypot(s.origin.x - x, s.origin.z - z);
      const emObra = !s.job.done;
      if (!melhor
        || (emObra && !melhor.emObra)
        || (emObra === melhor.emObra && d < melhor.dist)) {
        melhor = { kind: s.kind, dist: d, emObra, origin: s.origin };
      }
    }
    return melhor;
  }

  /**
   * Porta mais próxima de (x,z) dentro de `maxDist`, em coordenadas de mundo.
   * Só de casa pronta: mandar um bot visitar obra pela metade é mandá-lo entrar
   * por um vão que ainda vai virar parede.
   */
  nearestDoor(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const s of this.structures) {
      if (!s.door || !s.job.done) continue;
      const d = Math.hypot(s.door.x - x, s.door.z - z);
      if (d < bestD) { bestD = d; best = s.door; }
    }
    return best;
  }

  /**
   * A planta, posta em `origin`, atropelaria coisa de alguém?
   *
   * Do JOGADOR, só conta conflito de verdade: célula dele onde a obra quer
   * assentar bloco, ou bloco dele onde a obra quer vazio. Recusar por qualquer
   * célula dele era demais — quem quebra grama andando por aí vira dono de
   * dezenas de células de ar, e a planta limpa um volume enorme de ar antes de
   * montar. O resultado era a aldeia fugir para longe de quem mais joga.
   *
   * De um BOT, qualquer célula basta para recusar: dentro da sessão `_freeOf` já
   * afasta os sítios, então célula de bot aqui só pode ser de uma construção de
   * sessão ANTERIOR — que o mundo salvo trouxe de volta e que esta aldeia, nova
   * em folha, não conhece. Sem isto a casa de ontem virava alicerce da de hoje.
   */
  _siteIsFree(plan, origin) {
    for (const [x, y, z, id] of plan.blocks) {
      const wx = origin.x + x;
      const wy = origin.y + y;
      const wz = origin.z + z;
      const dono = this.world.ownerOf(wx, wy, wz);
      if (dono === Owner.BOT) return false;
      if (dono !== Owner.PLAYER) continue;
      const querVazio = id === Blocks.AIR;
      if (!querVazio || this.world.isSolid(wx, wy, wz)) return false;
    }
    return true;
  }

  /**
   * Já há obra de bot dentro (ou colada em) deste retângulo?
   *
   * `_freeOf` cuida do afastamento entre construções desta sessão, mas a aldeia
   * nasce vazia a cada carregamento do jogo, enquanto as casas ficam salvas. Só a
   * posse das células sabe o que já existe ali. Varre o retângulo inteiro, com a
   * margem do afastamento, e não só as células da planta: duas casas podem não
   * dividir célula nenhuma e ainda assim ficarem encavaladas.
   */
  _botWorkNear(bounds, y) {
    const m = 2;
    for (let x = bounds.x0 - m; x <= bounds.x1 + m; x++) {
      for (let z = bounds.z0 - m; z <= bounds.z1 + m; z++) {
        for (let dy = -1; dy <= 3; dy++) {
          if (this.world.ownerOf(x, y + dy, z) === Owner.BOT) return true;
        }
      }
    }
    return false;
  }

  _freeOf(bounds) {
    for (const s of this.structures) {
      const dx = Math.max(s.bounds.x0 - bounds.x1, bounds.x0 - s.bounds.x1, 0);
      const dz = Math.max(s.bounds.z0 - bounds.z1, bounds.z0 - s.bounds.z1, 0);
      if (Math.hypot(dx, dz) < SITE_MIN_DIST) return false;
    }
    return true;
  }

  /**
   * Centro de busca de sítio, puxado para perto do spawn. O bot pede obra onde
   * ele está, e ele vagueia; sem esta correção a aldeia se espalhava atrás dele
   * mundo afora. Ele caminha até o canteiro depois — andar é com o bot, não com
   * o jogador.
   */
  _searchCenter(cx, cz) {
    const dx = cx - this.spawn.x;
    const dz = cz - this.spawn.z;
    const d = Math.hypot(dx, dz);
    const limite = VILLAGE_RADIUS * 0.5;
    if (d <= limite || d === 0) return { x: cx, z: cz };
    return { x: this.spawn.x + (dx / d) * limite, z: this.spawn.z + (dz / d) * limite };
  }

  /** Tipos que ainda faltam nesta aldeia. */
  get pending() {
    const feitos = new Set(this.structures.map((s) => s.kind));
    return STRUCTURE_KINDS.filter((kind) => !feitos.has(kind));
  }

  /**
   * Ordem em que os tipos pendentes são tentados: casa antes de poço e roça.
   *
   * O poço é o menor de todos e por isso o que mais passa nos testes de terreno.
   * Deixado à sorte, ele saía primeiro quase sempre, e a primeira coisa que o
   * jogador via era um buraco no chão em vez de uma casa.
   */
  _kindOrder() {
    return this.pending
      .map((kind) => ({ kind, peso: (PEQUENAS.has(kind) ? 2 : 0) + this.rnd() }))
      .sort((a, b) => a.peso - b.peso)
      .map((o) => o.kind);
  }

  /**
   * Procura terreno para uma construção nova perto de (cx,cz). Devolve a obra
   * pronta para começar, ou null se não achou lugar — o que é comum em terreno
   * quebrado, e por isso o bot volta a vaguear em vez de insistir.
   *
   * Tenta os tipos em ordem: antes, um tipo azarado no sorteio significava obra
   * nenhuma naquela decisão, mesmo havendo lugar de sobra para outro.
   */
  planNear(cx, cz) {
    if (this.full) return null;
    for (const kind of this._kindOrder()) {
      const job = this._trySite(kind, cx, cz);
      if (job) return job;
      // Recusa contada por tipo: é ela que vai afrouxando o raio de quem não
      // acha lugar, para o sobrado não ficar de fora da aldeia para sempre.
      this._fails.set(kind, (this._fails.get(kind) || 0) + 1);
    }
    return null;
  }

  /** Raio permitido para este tipo, que cresce a cada recusa acumulada. */
  _radiusFor(kind) {
    const recusas = this._fails.get(kind) || 0;
    return Math.min(VILLAGE_RADIUS + Math.floor(recusas / RECUSAS_POR_BLOCO), VILLAGE_RADIUS_MAX);
  }

  _trySite(kind, cx, cz) {
    const plan = planStructure(kind, this.rnd);
    const fp = footprint(plan);
    const centro = this._searchCenter(cx, cz);
    const raio = this._radiusFor(kind);

    for (let t = 0; t < SITE_TRIES; t++) {
      const ang = this.rnd() * Math.PI * 2;
      const dist = 6 + this.rnd() * Math.max(4, raio - 6);
      const ox = Math.round(centro.x + Math.cos(ang) * dist);
      const oz = Math.round(centro.z + Math.sin(ang) * dist);

      const bounds = { x0: ox + fp.x0, z0: oz + fp.z0, x1: ox + fp.x1, z1: oz + fp.z1 };

      // Longe do spawn: casa em cima de quem acabou de entrar no jogo é armadilha.
      // Perto do spawn: a aldeia toda tem de caber num passeio curto.
      //
      // A folga do spawn mede a BEIRADA da construção, e o raio da aldeia mede o
      // centro. Medir os dois pelo centro deixava a parede de uma casa larga cair
      // a 3 blocos do spawn, com a folga de 7 satisfeita no papel.
      const bx = Math.max(bounds.x0 - this.spawn.x, this.spawn.x - bounds.x1, 0);
      const bz = Math.max(bounds.z0 - this.spawn.z, this.spawn.z - bounds.z1, 0);
      if (Math.hypot(bx, bz) < SPAWN_CLEAR) continue;
      const centro2 = Math.hypot((bounds.x0 + bounds.x1) / 2 - this.spawn.x,
        (bounds.z0 + bounds.z1) / 2 - this.spawn.z);
      if (centro2 > raio) continue;
      if (!this._freeOf(bounds)) continue;

      // Terreno: mede o desnível de todo o retângulo, não só dos cantos.
      let lo = Infinity;
      let hi = -Infinity;
      let ok = true;
      for (let z = bounds.z0; z <= bounds.z1 && ok; z++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          const h = this.world.surfaceHeight(x, z);
          if (h < 1) { ok = false; break; }
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      if (!ok || hi - lo > MAX_SLOPE) continue;

      const origin = { x: ox, y: hi + 1, z: oz };
      // Terreno onde o jogador mexeu não vira canteiro de obra. O descarte de
      // bloco no step() já protege o que é dele, mas uma casa erguida em cima da
      // construção do jogador sairia esburacada e por cima do trabalho alheio —
      // o lugar certo de recusar é aqui, antes de assentar o primeiro bloco.
      if (!this._siteIsFree(plan, origin)) continue;
      if (this._botWorkNear(bounds, origin.y)) continue;
      // A porta olha para -Z, então "dentro" é alguns blocos em +Z. O bot visita
      // parando na soleira e depois entrando: parar na porta é ficar de fora.
      const door = plan.door
        ? {
          x: origin.x + plan.door.x + 0.5,
          y: origin.y,
          z: origin.z + plan.door.z + 0.5,
          inside: {
            x: origin.x + plan.door.x + 0.5,
            z: origin.z + plan.door.z + 0.5 + Math.abs(plan.door.z) + 2,
          },
        }
        : null;
      // A obra fica guardada com o registro: é o que separa casa pronta de
      // canteiro de obra. Sem isso a aldeia dava por construída uma casa no
      // instante em que o sítio era escolhido, antes do primeiro bloco.
      const job = new BuildJob(this.world, origin, plan);
      this.structures.push({ kind, origin, door, bounds, job });
      return job;
    }
    return null;
  }
}
