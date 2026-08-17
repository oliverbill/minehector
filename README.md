# CuboCraft

Jogo voxel estilo Minecraft, single-player, que roda inteiro no navegador — sem servidor,
sem build step, sem dependências além do Three.js vendorado em `lib/`.

**Jogar: [oliverbill.github.io/minehector](https://oliverbill.github.io/minehector/)**

Publicado por GitHub Pages a partir da raiz da branch `main` — o que está em `main` é o que
está no ar, sem workflow no meio. O mundo é salvo no IndexedDB do próprio navegador, então
cada pessoa que abrir o link tem o seu.

## Rodar localmente

Sirva a pasta com qualquer servidor estático e abra no navegador:

```sh
python3 -m http.server 8080
# http://localhost:8080
```

(Abrir o `index.html` direto por `file://` não funciona — ES modules exigem HTTP.)

## Controles

| Tecla | Ação |
| --- | --- |
| WASD | andar |
| Espaço | pular |
| Shift | correr |
| Mouse esq. | quebrar bloco |
| Mouse dir. | colocar bloco |
| 1–7 | escolher bloco do hotbar (7 = água) |
| V | alternar 1ª pessoa → 3ª pessoa → 3ª de frente |
| Espaço (na água) | nadar para cima |
| ESC | soltar o mouse |

**Piscinas.** A água é o único bloco que não é parede: você atravessa nadando.
Cave um buraco, encha com o bloco 7 e pule dentro — lá dentro a queda é lenta e
o Espaço sobe. A mira acerta a água, então dá para esvaziar a piscina quebrando
bloco por bloco.

Em 3ª pessoa você se vê: o boneco do jogador é o Heitor — moletom preto de
zíper, bermuda clara, tênis escuros e as luvas de boxe vermelhas.

## O que acontece sozinho no mundo

Três bots (Ana, Beto e Caio) vivem no mundo com a mesma física do jogador. Cada um é um boneco
humanoide com skin própria, gerada a partir do nome. Eles vagueiam, às vezes seguem você, e
**levantam construções**: cabana com varanda, casa de palafita com escada, torre de vigia com
caracol e sacada, poço, roça cercada e sobrado de dois andares. A obra é assentada bloco a bloco,
à vista.

Todas as construções são habitáveis: porta de 2 blocos, pé-direito de 2 e degraus de 1 — você
entra, sobe as escadas e chega à sacada da torre e ao andar de cima do sobrado. Os bots também
entram nelas.

A aldeia nasce **em volta do seu spawn**: o primeiro canteiro abre em
poucos segundos e a primeira casa fica pronta em torno de meio minuto, sem você precisar sair
procurando. Sai **uma de cada**: as seis construções, sem repetir, a maioria entre 10 e 20 blocos
(o sobrado, que é o maior, pode ir um pouco mais longe atrás de terreno plano). A linha amarela
da HUD aponta a construção mais próxima, diz a que distância está e quantas ainda faltam.

O que é seu ninguém mexe — nem você derruba a casa dos bots, nem eles assentam bloco por cima
do que você construiu ou cavou.

## Arquitetura

Mundo infinito em chunks 16×16×64 gerados por ruído simplex a partir de uma seed;
meshing com face culling (uma malha por chunk, atlas de texturas procedural);
física AABB própria contra a grade de voxels; bots com FSM simples que usam a mesma
física do jogador; persistência apenas das diferenças (blocos editados) em IndexedDB.

Detalhes e contratos entre módulos: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Testes

```sh
node tests/run.mjs
```

Sem dependências: os testes carregam os módulos reais do jogo, com o especificador `three`
resolvido para `lib/three.module.js` como o importmap do `index.html` faz no navegador.
Cobrem a interação — mira, colocar, quebrar, alcance e o contrato do raycast.

```
js/
  constants.js   dimensões, ids de bloco, seed
  world/         ruído, geração de chunks, estado do mundo, saves (IndexedDB)
  render/        atlas procedural, mesher (face culling), cena e malhas por chunk
  player/        input (pointer lock), física AABB, raycast DDA, interação
  bots/          FSM e corpos dos bots
  main.js        boot e game loop
```
