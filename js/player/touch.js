// Controles de toque — iPhone, iPad e Android.
//
// O jogo nasceu preso ao pointer lock: clicar prende o mouse, e era o lock que
// dizia ao loop que o jogador estava no comando. No iPhone o pointer lock não
// existe e no iPad só funciona com trackpad, então `requestPointerLock()` não
// fazia nada, o overlay "Clique para jogar" nunca sumia e o mundo ficava parado
// atrás dele. Sem teclado não há WASD, sem botão direito não há como colocar
// bloco: no celular, faltavam TODOS os comandos, não um.
//
// Aqui o dedo faz os dois papéis: manche à esquerda (anda, e empurrado até o fim
// corre), arrasto à direita (olha), toque curto à direita (quebra o bloco
// mirado — ou acerta a ovelha) e botões para pular, colocar, comer, trocar de
// câmera e voltar ao menu. Tudo entra pelo Input, então Player, Interaction e
// View seguem sem saber de nada.
//
// O manche e o olhar são ouvidos por EVENTOS DE TOQUE, e não por pointer events.
// Não é preferência de gosto: com dois dedos na tela — que é como se joga no
// iPad — o `pointerId` do Safari não é de fiar. Ao levantar um dos dedos, os que
// ficam podem ser renumerados, e então o `pointerup` do manche chega com um id
// que não é o que desceu. O gesto nunca era solto: o jogador andava para a
// frente para sempre e o manche não aceitava dedo novo (`_stickId` preso num id
// que nunca mais voltaria) — a tela inteira travada, que é o defeito do iPad.
// O `identifier` de um Touch, esse, é o mesmo do touchstart ao touchend.
//
// Os botões continuam em pointer events: um botão é um toque só, e assim eles
// também respondem ao trackpad de um iPad com teclado. Mas ninguém fica preso:
// `touchend` sem nenhum dedo restante na tela solta TUDO, e perder a janela
// (trocar de aba, atender uma chamada) faz o mesmo.
//
// A geometria do manche (`stickVector`) é função pura de propósito: é a única
// parte que dá para testar sem tela nem dedo, e é onde mora a regra de que meio
// empurrão anda meia velocidade.

const DEAD_ZONE = 0.18;   // fração do raio ignorada: dedo pousado não é dedo andando
const RUN_AT = 0.82;      // manche além disto corre — é o Shift do celular
const LOOK_SENS = 1.7;    // arrastar cansa mais que mexer o mouse; o dedo rende mais por px
const TAP_MS = 260;       // toque mais curto que isto, e parado, é clique e não olhada
const TAP_PX = 14;
const REPEAT_MS = 260;    // segurar quebrar/colocar repete neste passo

export const STICK_RADIUS = 56;  // px do centro à borda do manche

/**
 * Deslocamento do dedo (px, a partir do centro do manche) -> comando de andar.
 * `forward` positivo anda para onde se olha; `strafe` positivo, para a direita.
 * `dx`/`dy` voltam limitados ao raio, para desenhar o botão do manche.
 */
export function stickVector(dx, dy, radius = STICK_RADIUS) {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * DEAD_ZONE) {
    return { forward: 0, strafe: 0, run: false, dx: 0, dy: 0 };
  }
  const preso = Math.min(dist, radius);
  const forca = preso / radius;                 // 0..1 — é o que dá o meio-termo
  return {
    forward: (-dy / dist) * forca,              // dedo para cima (dy negativo) = para a frente
    strafe: (dx / dist) * forca,
    run: forca >= RUN_AT,
    dx: (dx / dist) * preso,
    dy: (dy / dist) * preso,
  };
}

/**
 * O aparelho tem tela de toque? O iPad do Safari moderno se declara Mac no user
 * agent — o que ele não consegue esconder é ter dedos, e é isso que se pergunta.
 */
export function isTouchDevice() {
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints || 0) > 0
    || (typeof window !== 'undefined' && 'ontouchstart' in window);
}

/** O toque de `identifier` dado, ou null. TouchList é array-like, não array. */
function acharDedo(lista, id) {
  if (!lista) return null;
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].identifier === id) return lista[i];
  }
  return null;
}

export class TouchControls {
  /**
   * @param {import('./input.js').Input} input
   * @param {{ onMenu?: () => void }} [opts] — o botão ☰ devolve ao overlay
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.onMenu = opts.onMenu;
    this._stick = null;          // { id, ox, oy } — id é o identifier do Touch
    this._look = null;           // { id, x, y, andou, t0 }
    this._repeats = new Map();   // pointerId -> id do setInterval
    this._pressed = new Map();   // pointerId -> botão apertado

    this.root = document.getElementById('touch');
    if (!this.root) return;
    this.base = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');

    this._bindStick(document.getElementById('stick-zone'));
    this._bindLook(document.getElementById('look-zone'));
    this._bindDedos();
    for (const btn of this.root.querySelectorAll('[data-action]')) this._bindButton(btn);
  }

  // O manche nasce onde o polegar pousou, e não num canto fixo: em tela de
  // celular a mão não mira, ela larga o dedo perto de onde já está.
  //
  // O toque só COMEÇA na zona: o resto do gesto é ouvido na janela (_bindDedos),
  // porque o polegar atravessa a divisa das metades a cada curva e um handler
  // preso ao elemento perderia o fim do gesto do outro lado.
  _bindStick(zone) {
    if (!zone) return;
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (!t || this._stick) return;   // um manche de cada vez
      e.preventDefault();              // sem clique fantasma nem zoom por duplo toque
      this._stick = { id: t.identifier, ox: t.clientX, oy: t.clientY };
      if (this.base) {
        this.base.style.left = `${t.clientX}px`;
        this.base.style.top = `${t.clientY}px`;
        this.base.classList.add('on');
      }
      this._move(0, 0);
    }, { passive: false });
  }

  // Metade direita: arrastar olha. O toque curto e parado vira clique esquerdo —
  // sem isso, quebrar bloco dependeria de acertar o botão, e mirar e quebrar são
  // o mesmo gesto na cabeça de quem joga.
  _bindLook(zone) {
    if (!zone) return;
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (!t || this._look) return;
      e.preventDefault();
      this._look = {
        id: t.identifier, x: t.clientX, y: t.clientY, andou: 0, t0: performance.now(),
      };
    }, { passive: false });
  }

  // O meio do gesto e o fim dele, para os dois papéis, num lugar só: cada dedo é
  // reconhecido pelo `identifier` que trouxe do touchstart, e nenhum papel
  // sobrevive à saída do seu dedo da tela.
  _bindDedos() {
    window.addEventListener('touchmove', (e) => {
      if (this._stick) {
        const t = acharDedo(e.changedTouches, this._stick.id);
        if (t) this._move(t.clientX - this._stick.ox, t.clientY - this._stick.oy);
      }
      if (this._look) {
        const t = acharDedo(e.changedTouches, this._look.id);
        if (t) {
          const dx = t.clientX - this._look.x;
          const dy = t.clientY - this._look.y;
          this._look.x = t.clientX;
          this._look.y = t.clientY;
          this._look.andou += Math.hypot(dx, dy);
          this.input.addLook(dx * LOOK_SENS, dy * LOOK_SENS);
        }
      }
    }, { passive: true });

    const fim = (e) => {
      if (this._stick && acharDedo(e.changedTouches, this._stick.id)) this._soltarManche();
      if (this._look && acharDedo(e.changedTouches, this._look.id)) {
        this._soltarOlhar(e.type === 'touchend');
      }
      // A rede por baixo de tudo: sem dedo nenhum na tela, nada pode continuar
      // apertado. Qualquer evento perdido — e o iOS perde — morre aqui.
      if (!e.touches || e.touches.length === 0) this._soltarTudo();
    };
    window.addEventListener('touchend', fim);
    window.addEventListener('touchcancel', fim);

    // Sair da janela no meio do gesto (aba, chamada, notificação) não devolve
    // touchend nenhum: sem isto, voltar ao jogo é voltar já andando.
    window.addEventListener('blur', () => this._soltarTudo());
  }

  _move(dx, dy) {
    const v = stickVector(dx, dy);
    this.input.setStick(v.forward, v.strafe);
    this.input.setVirtualKey('ShiftLeft', v.run);
    if (this.knob) {
      this.knob.style.transform = `translate(calc(-50% + ${v.dx}px), calc(-50% + ${v.dy}px))`;
    }
  }

  _soltarManche() {
    this._stick = null;
    if (this.base) this.base.classList.remove('on');
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
    this.input.setStick(0, 0);
    this.input.setVirtualKey('ShiftLeft', false);
  }

  /** @param {boolean} podeSerToque — cancelado pelo sistema não conta como toque. */
  _soltarOlhar(podeSerToque) {
    const o = this._look;
    this._look = null;
    if (!o || !podeSerToque) return;
    if (o.andou < TAP_PX && performance.now() - o.t0 < TAP_MS) this.input.emitMouseButton(0);
  }

  _soltarBotoes() {
    for (const timer of this._repeats.values()) clearInterval(timer);
    this._repeats.clear();
    for (const btn of this._pressed.values()) btn.classList.remove('press');
    this._pressed.clear();
    this.input.setVirtualKey('Space', false);
  }

  _soltarTudo() {
    this._soltarManche();
    this._soltarOlhar(false);
    this._soltarBotoes();
  }

  // Quebrar e colocar repetem enquanto o botão está apertado: um bloco por toque
  // transforma cavar um buraco em dezenas de toques.
  _bindButton(btn) {
    const acao = btn.dataset.action;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('press');
      this._pressed.set(e.pointerId, btn);
      switch (acao) {
        case 'pular':
          this.input.setVirtualKey('Space', true);
          break;
        case 'quebrar':
        case 'colocar': {
          const botao = acao === 'quebrar' ? 0 : 2;
          this.input.emitMouseButton(botao);
          this._repeats.set(e.pointerId, setInterval(
            () => this.input.emitMouseButton(botao), REPEAT_MS,
          ));
          break;
        }
        case 'visao':
          this.input.emitKeyPress('KeyV');
          break;
        case 'comer':
          this.input.emitKeyPress('KeyE');
          break;
        case 'menu':
          if (this.onMenu) this.onMenu();
          break;
        default:
          break;
      }
    });

    // Soltar também é ouvido na janela, e não no botão: o dedo escorrega para
    // fora do círculo o tempo todo, e um `pointerup` perdido significa pulo
    // preso para sempre ou martelada que não pára. Só solta o botão DESTE
    // ponteiro — antes, levantar o polegar do manche largava o pulo junto.
    const solta = (e) => {
      if (this._pressed.get(e.pointerId) !== btn) return;
      this._pressed.delete(e.pointerId);
      btn.classList.remove('press');
      if (acao === 'pular') this.input.setVirtualKey('Space', false);
      const timer = this._repeats.get(e.pointerId);
      if (timer !== undefined) {
        clearInterval(timer);
        this._repeats.delete(e.pointerId);
      }
    };
    window.addEventListener('pointerup', solta);
    window.addEventListener('pointercancel', solta);
  }

  /** Pausar no meio de um gesto não pode deixar dedo (nem repetição) pendurado. */
  reset() {
    this._soltarTudo();
  }
}
