// Entrada de teclado/mouse — e o que o toque injeta por cima. O pointer lock é
// PEDIDO pelo main (clique no overlay); esta classe apenas observa
// `pointerlockchange` para saber se está ativo.
//
// No iPhone não existe pointer lock (no iPad, só com trackpad ligado). Como o
// loop do jogo só andava com `locked`, o overlay "Clique para jogar" nunca sumia
// e o mundo ficava congelado — era exatamente isso que "não funciona no iPhone"
// queria dizer. Por isso o comando agora tem duas fontes: o pointer lock e o
// toque (`js/player/touch.js`), e quem pergunta usa `active`, não `locked`.
//
// O toque não conversa com Player, Interaction ou View: ele escreve aqui —
// tecla virtual, olhar virtual, clique virtual, manche — e nada abaixo desta
// classe precisa saber se veio de dedo ou de teclado.

export class Input {
  constructor(canvas) {
    this._canvas = canvas;
    this._keys = new Set();
    this._virtual = new Set();  // teclas seguradas pelo toque
    this._stick = null;         // manche analógico, ou null quando solto
    this._dx = 0;
    this._dy = 0;
    this._locked = false;
    this._touchActive = false;
    this._mouseButtonCbs = [];
    this._keyPressCbs = [];

    if (typeof document === 'undefined' || !document.addEventListener) return;

    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === canvas;
      if (!this._locked) this._keys.clear(); // evita tecla presa ao soltar o lock
    });

    document.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (!e.repeat) {
        for (const cb of this._keyPressCbs) cb(e.code);
      }
    });

    document.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (this._locked) {
        this._dx += e.movementX;
        this._dy += e.movementY;
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (this._locked) {
        for (const cb of this._mouseButtonCbs) cb(e.button);
      }
    });

    // No documento inteiro, não só no canvas: um menu de contexto aberto rouba
    // o pointer lock, e a partir daí todo clique do jogo deixa de responder.
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) {
    return this._keys.has(code) || this._virtual.has(code);
  }

  consumeMouseDelta() {
    const delta = { dx: this._dx, dy: this._dy };
    this._dx = 0;
    this._dy = 0;
    return delta;
  }

  onMouseButton(cb) {
    this._mouseButtonCbs.push(cb);
  }

  onKeyPress(cb) {
    this._keyPressCbs.push(cb);
  }

  // --- o que o toque escreve -------------------------------------------------

  /** Segura (ou solta) uma tecla sem teclado: o botão de pular é `Space`. */
  setVirtualKey(code, down) {
    if (down) this._virtual.add(code);
    else this._virtual.delete(code);
  }

  /** Arrasto do dedo somado ao mesmo acumulador do mouse. */
  addLook(dx, dy) {
    this._dx += dx;
    this._dy += dy;
  }

  /** Clique virtual (0 quebra, 2 coloca), pelo mesmo caminho do mousedown. */
  emitMouseButton(button) {
    for (const cb of this._mouseButtonCbs) cb(button);
  }

  /** Tecla virtual de um toque só: trocar de câmera, escolher bloco. */
  emitKeyPress(code) {
    for (const cb of this._keyPressCbs) cb(code);
  }

  /**
   * Manche analógico, em [-1, 1] cada eixo. `forward` positivo anda para onde se
   * olha, `strafe` positivo anda para a direita. null = solto.
   */
  setStick(forward, strafe) {
    this._stick = (forward === 0 && strafe === 0) ? null : { forward, strafe };
  }

  get stick() {
    return this._stick;
  }

  /** Pointer lock de verdade — o toque não finge ter um. */
  get locked() {
    return this._locked;
  }

  /** O jogador está no comando? É isto que o loop do jogo pergunta. */
  get active() {
    return this._locked || this._touchActive;
  }

  set touchActive(v) {
    this._touchActive = !!v;
    if (!v) {
      this._virtual.clear();  // sem isto, pausar segurando o pular deixa a tecla presa
      this._stick = null;
    }
  }

  get touchActive() {
    return this._touchActive;
  }
}
