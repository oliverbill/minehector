# CuboCraft

Jogo voxel estilo Minecraft, single-player, que roda inteiro no navegador — sem servidor,
sem build step, sem dependências além do Three.js vendorado em `lib/`.

**Jogar: https://oliverbill.github.io/minehector/**

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
| 1–6 | escolher bloco do hotbar |
| ESC | soltar o mouse |

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
