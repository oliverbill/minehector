// Entrada de teclado/mouse. O pointer lock é PEDIDO pelo main (clique no overlay);
// esta classe apenas observa `pointerlockchange` para saber se está ativo.

export class Input {
  constructor(canvas) {
    this._canvas = canvas;
    this._keys = new Set();
    this._dx = 0;
    this._dy = 0;
    this._locked = false;
    this._mouseButtonCbs = [];
    this._keyPressCbs = [];

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

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) {
    return this._keys.has(code);
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

  get locked() {
    return this._locked;
  }
}
