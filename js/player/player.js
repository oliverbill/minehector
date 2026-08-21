// Jogador em primeira pessoa. Movimento WASD relativo ao yaw, pulo, corrida.
// Convenção Three.js: rotation.order 'YXZ', yaw em torno de Y, olhar para -Z
// quando yaw = 0 — direção horizontal do olhar = (-sin(yaw), -cos(yaw)).
//
// FÔLEGO E CARNE. A caça precisa servir para alguma coisa, senão a ovelha vira
// um enfeite que solta um número no canto da tela. O fôlego é o que dá sentido a
// ela: correr gasta, e sem fôlego não se corre — e a ovelha em pânico foge a
// 4,2 blocos/s, que é mais que os 4,3 de quem anda depois de descontar o tempo
// de contornar uma árvore. Ou seja: para caçar é preciso correr, correr gasta
// fôlego, e o fôlego volta comendo o que se caçou. O laço se fecha sozinho.
//
// Sem barra de vida e sem morrer de fome de propósito: o castigo de ficar sem
// fôlego é andar devagar e não poder correr, e isso já se sente. Morrer num jogo
// que se joga de dez em dez minutos é perder o mundo por desatenção.
import { moveEntity, inLiquid, SWIM_UP } from './physics.js';

const WALK_SPEED = 4.3;   // blocos/s
const RUN_SPEED = 5.6;
const JUMP_SPEED = 8.5;
const EYE_HEIGHT = 1.62;
const MOUSE_SENS = 0.0025; // rad/px
const MAX_PITCH = (89 * Math.PI) / 180;

// Fôlego em [0, 1]. Os drenos são por segundo de movimento, não por segundo de
// jogo: ficar parado admirando o pôr do sol não cansa ninguém.
export const DRENO_ANDANDO = 0.004;    // ~4 min andando sem parar
export const DRENO_CORRENDO = 0.011;   // ~1,5 min de corrida cheia
export const DRENO_PULO = 0.003;       // por pulo, e pular é como se sobe morro
export const REFEICAO = 0.45;          // fôlego que uma carne repõe
export const SEM_FOLEGO = 0.72;        // fração da velocidade de quem zerou
export const POUCO_FOLEGO = 0.25;      // daqui para baixo a HUD começa a piscar

export class Player {
  constructor(world, spawnPos) {
    this.world = world;
    this.pos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = 0.6;
    this.height = 1.8;
    this.onGround = false;
    this.yaw = 0;   // radianos; sem clamping (dá voltas)
    this.pitch = 0; // radianos; clampado a ±89°

    this.folego = 1;   // [0, 1]
    this.carne = 0;    // pedaços de carne no bolso, um por refeição
  }

  get eyePos() {
    return { x: this.pos.x, y: this.pos.y + EYE_HEIGHT, z: this.pos.z };
  }

  /** Está sem gás? É isto que tira a corrida e acende o aviso na HUD. */
  get exausto() {
    return this.folego <= 0;
  }

  /**
   * Come um pedaço de carne. Devolve o que aconteceu, para quem chamou dizer ao
   * jogador — recusa silenciosa é indistinguível de botão quebrado, que é a
   * mesma regra do `say` da Interaction.
   * @returns {'comeu' | 'sem carne' | 'cheio'}
   */
  comer() {
    if (this.carne <= 0) return 'sem carne';
    if (this.folego >= 0.995) return 'cheio';
    this.carne -= 1;
    this.folego = Math.min(1, this.folego + REFEICAO);
    return 'comeu';
  }

  update(dt, input) {
    // Olhar.
    const { dx, dy } = input.consumeMouseDelta();
    this.yaw -= dx * MOUSE_SENS;
    this.pitch -= dy * MOUSE_SENS;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;

    // WASD projetado no plano XZ pelo yaw (W = direção do olhar horizontal).
    let forward = 0;
    let strafe = 0;
    if (input.isDown('KeyW')) forward += 1;
    if (input.isDown('KeyS')) forward -= 1;
    if (input.isDown('KeyD')) strafe += 1;
    if (input.isDown('KeyA')) strafe -= 1;

    // Manche do toque, quando há um: soma ao teclado e, ao contrário dele, tem
    // meio-termo — empurrado pela metade, anda pela metade.
    const stick = input.stick;
    if (stick) {
      forward += stick.forward;
      strafe += stick.strafe;
    }

    // Correr é pedido pelo Shift (ou pelo manche empurrado até o fim), mas só
    // sai com fôlego. Zerado, a passada ainda encurta: sem isso, o fim do gás
    // seria só a ausência de uma tecla, e ninguém percebe o que não acontece.
    const querCorrer = input.isDown('ShiftLeft');
    const correndo = querCorrer && !this.exausto;
    const speed = correndo ? RUN_SPEED : WALK_SPEED * (this.exausto ? SEM_FOLEGO : 1);
    if (forward !== 0 || strafe !== 0) {
      // Normaliza a diagonal do teclado sem apagar a força do analógico: o que
      // passa de 1 é cortado, o que está abaixo é respeitado.
      const len = Math.hypot(forward, strafe);
      const escala = Math.min(len, 1) / len;
      const f = forward * escala;
      const s = strafe * escala;
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      // frente = (-sin, -cos); direita = (cos, -sin)
      this.vel.x = (f * -sinY + s * cosY) * speed;
      this.vel.z = (f * -cosY + s * -sinY) * speed;
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
    }

    // Na água, o espaço nada para cima enquanto estiver segurado — não é pulo,
    // que só sai do chão. É assim que se sobe de volta do fundo da piscina.
    if (input.isDown('Space')) {
      if (inLiquid(this.world, this)) this.vel.y = SWIM_UP;
      else if (this.onGround) {
        this.vel.y = JUMP_SPEED;
        this._gastar(DRENO_PULO);
      }
    }

    moveEntity(this.world, this, dt);

    // O gasto é medido DEPOIS de mover, com a velocidade que sobreviveu à
    // colisão: empurrar uma parede com o W apertado não anda ninguém, e não
    // teria por que cansar. Meio manche gasta meio, pela mesma conta.
    const andou = Math.hypot(this.vel.x, this.vel.z);
    if (andou > 0.05) {
      const dreno = correndo ? DRENO_CORRENDO : DRENO_ANDANDO;
      this._gastar(dreno * dt * Math.min(1, andou / WALK_SPEED));
    }
  }

  _gastar(quanto) {
    this.folego = Math.max(0, this.folego - quanto);
  }
}
