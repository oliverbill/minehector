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
// mirado) e botões para pular, colocar, trocar de câmera e voltar ao menu. Tudo
// entra pelo Input, então Player, Interaction e View seguem sem saber de nada.
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

export class TouchControls {
  /**
   * @param {import('./input.js').Input} input
   * @param {{ onMenu?: () => void }} [opts] — o botão ☰ devolve ao overlay
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.onMenu = opts.onMenu;
    this._lookId = null;
    this._stickId = null;
    this._repeats = new Map();   // pointerId -> id do setInterval

    this.root = document.getElementById('touch');
    if (!this.root) return;
    this.base = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');

    this._bindStick(document.getElementById('stick-zone'));
    this._bindLook(document.getElementById('look-zone'));
    for (const btn of this.root.querySelectorAll('[data-action]')) this._bindButton(btn);
  }

  // O manche nasce onde o polegar pousou, e não num canto fixo: em tela de
  // celular a mão não mira, ela larga o dedo perto de onde já está.
  //
  // O toque COMEÇA na zona, mas o resto do gesto é ouvido na janela: o polegar
  // atravessa a divisa das metades a cada curva, e handler preso ao elemento
  // perderia o `pointerup` do outro lado — o jogador ficaria andando sozinho, de
  // manche solto, sem nada para soltar.
  _bindStick(zone) {
    if (!zone) return;
    let ox = 0, oy = 0;

    zone.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      e.preventDefault();
      if (this.base) {
        this.base.style.left = `${ox}px`;
        this.base.style.top = `${oy}px`;
        this.base.classList.add('on');
      }
      this._move(0, 0);
    });

    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      this._move(e.clientX - ox, e.clientY - oy);
    });

    const solta = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      if (this.base) this.base.classList.remove('on');
      if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
      this.input.setStick(0, 0);
      this.input.setVirtualKey('ShiftLeft', false);
    };
    window.addEventListener('pointerup', solta);
    window.addEventListener('pointercancel', solta);
  }

  _move(dx, dy) {
    const v = stickVector(dx, dy);
    this.input.setStick(v.forward, v.strafe);
    this.input.setVirtualKey('ShiftLeft', v.run);
    if (this.knob) {
      this.knob.style.transform = `translate(calc(-50% + ${v.dx}px), calc(-50% + ${v.dy}px))`;
    }
  }

  // Metade direita: arrastar olha. O toque curto e parado vira clique esquerdo —
  // sem isso, quebrar bloco dependeria de acertar o botão, e mirar e quebrar são
  // o mesmo gesto na cabeça de quem joga.
  _bindLook(zone) {
    if (!zone) return;
    let lx = 0, ly = 0, andou = 0, t0 = 0;

    zone.addEventListener('pointerdown', (e) => {
      if (this._lookId !== null) return;
      this._lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      andou = 0;
      t0 = performance.now();
      e.preventDefault();
    });

    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      andou += Math.hypot(dx, dy);
      this.input.addLook(dx * LOOK_SENS, dy * LOOK_SENS);
    });

    const solta = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
      if (e.type === 'pointerup' && andou < TAP_PX && performance.now() - t0 < TAP_MS) {
        this.input.emitMouseButton(0);
      }
    };
    window.addEventListener('pointerup', solta);
    window.addEventListener('pointercancel', solta);
  }

  // Quebrar e colocar repetem enquanto o botão está apertado: um bloco por toque
  // transforma cavar um buraco em dezenas de toques.
  _bindButton(btn) {
    const acao = btn.dataset.action;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('press');
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
        case 'menu':
          if (this.onMenu) this.onMenu();
          break;
        default:
          break;
      }
    });

    // Soltar também é ouvido na janela, e não no botão: o dedo escorrega para
    // fora do círculo o tempo todo, e um `pointerup` perdido significa pulo
    // preso para sempre ou martelada que não pára.
    const solta = (e) => {
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
    for (const timer of this._repeats.values()) clearInterval(timer);
    this._repeats.clear();
    this._stickId = null;
    this._lookId = null;
    if (this.base) this.base.classList.remove('on');
  }
}
