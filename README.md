# Minehector

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
| 1–9 | escolher bloco do hotbar (7 água, 8 lava, 9 fogo) |
| Mouse esq. na ovelha | caçar (três picaretadas) |
| E | comer a carne e repor o fôlego |
| V | alternar 1ª pessoa → 3ª pessoa → 3ª de frente |
| Espaço (na água) | nadar para cima |
| ESC | soltar o mouse |

## No celular e no tablet

**O jogo também se joga com o dedo** — iPhone, iPad e Android. O jogo nascia preso
ao pointer lock, que no iPhone não existe e no iPad só funciona com trackpad: o
"Clique para jogar" nunca sumia e o mundo ficava parado atrás dele. Agora, em tela
de toque, o menu some ao primeiro toque e aparecem os controles:

| Gesto | Ação |
| --- | --- |
| Manche na metade esquerda | andar — nasce onde o polegar pousa; até o fim, corre |
| Arrastar na metade direita | olhar |
| Tocar na metade direita | quebrar o bloco mirado — ou acertar a ovelha |
| ⤒ | pular (e nadar para cima, dentro da água) |
| ✖ / ▣ | quebrar / colocar — segurando, repete |
| 🍖 | comer a carne e repor o fôlego |
| ◉ | 1ª pessoa → 3ª → 3ª de frente |
| ☰ | voltar ao menu (é o ESC do celular) |
| Toque no hotbar | escolher o bloco |

O hotbar sobe para o topo (embaixo moram os polegares) e vira só os ícones. A tela
inteira é do jogo: sem zoom de dois dedos, sem puxão para recarregar e sem a barra
de endereço comendo o rodapé. Em tela de toque o raio de visão cai de 4 para 3
chunks e o render deixa de multiplicar pelos 3 pixels físicos do iPhone — é o que
mantém o jogo fluido no aparelho.

**O mundo muda de hora e de tempo.** Manhã, tarde e noite, 15 minutos cada, com o sol
cruzando o céu, a lua e as estrelas de noite e nuvens passando. De vez em quando chove ou
neva. A HUD mostra o período, quanto falta e o tempo.

**O cenário tem mais coisa.** Além do carvalho, há bosques de pinheiro (copa cônica) e de
bétula (tronco claro); flores vermelhas e amarelas e capim alto nascem na grama; e há lava,
com fogo na beirada, tanto no fundo do mundo quanto em lagos à flor da terra.

**Piscinas.** A água é o único bloco que não é parede: você atravessa nadando.
Cave um buraco, encha com o bloco 7 e pule dentro — lá dentro a queda é lenta e
o Espaço sobe. A mira acerta a água, então dá para esvaziar a piscina quebrando
bloco por bloco.

**Ovelhas, e caçar para comer.** Há um rebanho pastando na grama à sua volta. Ele
não foge de quem passa perto: a ovelha levanta a cabeça, olha e volta a pastar. Mas
quem apanha dispara — e foge mais rápido do que você anda, então **caçar é correr
atrás**. São três picaretadas, e cada ovelha rende dois pedaços de carne.

Correr gasta fôlego (a barrinha 🍖 da HUD), e sem fôlego você não corre e ainda anda
mais devagar — é aí que a carne serve: **E** no teclado, 🍖 no celular, e o fôlego
volta. A barra pisca em vermelho quando está no fim. Ninguém morre de fome; o que se
perde é a corrida, e sem corrida não se caça mais nada.

Em 3ª pessoa você se vê: o boneco do jogador é o Heitor — moletom preto de
zíper, bermuda clara, tênis escuros e as luvas de boxe vermelhas. E **a picareta
está sempre na mão**: em 1ª pessoa no canto da tela, batendo a cada clique; em 3ª,
na mão direita do boneco.

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
física AABB própria contra a grade de voxels; bots e ovelhas com FSM simples que usam
a mesma física do jogador; persistência apenas das diferenças (blocos editados) em IndexedDB.

Detalhes e contratos entre módulos: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Testes

```sh
node tests/run.mjs
```

Sem dependências: os testes carregam os módulos reais do jogo, com o especificador `three`
resolvido para `lib/three.module.js` como o importmap do `index.html` faz no navegador.
Cobrem a interação — mira, colocar, quebrar, alcance e o contrato do raycast — e o
laço da caça: a mira disputada entre ovelha e bloco, os três golpes, o rebanho
nascendo na grama e o fôlego que a carne repõe.

```
js/
  constants.js   dimensões, ids de bloco, seed
  world/         ruído, geração de chunks, estado do mundo, saves (IndexedDB)
  render/        atlas procedural, mesher (face culling), cena e malhas por chunk,
                 picareta (na câmera em 1ª pessoa, na mão do boneco em 3ª)
  player/        input (pointer lock + toque), touch (manche e botões),
                 física AABB, raycast DDA, interação
  bots/          FSM e corpos dos bots
  mobs/          ovelhas: FSM, corpo, rebanho e a mira que as acerta
  main.js        boot e game loop
```
