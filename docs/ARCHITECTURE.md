# Minehector — arquitetura e contratos entre módulos

Jogo voxel estilo Minecraft, single-player, navegador, sem build step:
ES modules puros + Three.js vendorado em `lib/three.module.js` (import via importmap, specifier `"three"`).
**Só JavaScript** — nada de TypeScript, nada de dependências externas além do Three.js vendorado.

Convenções globais:

- Coordenadas de mundo (`wx, wy, wz`) são em blocos; a célula do bloco ocupa `[wx, wx+1) × [wy, wy+1) × [wz, wz+1)`.
- Chunk indexado por `(cx, cz)`; bloco de mundo → chunk: `cx = Math.floor(wx / CHUNK_SIZE)`.
- Dados do chunk: `Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT)` com ids de `Blocks`; índice via `blockIndex(x, y, z)` de `js/constants.js`.
- `wy` fora de `[0, CHUNK_HEIGHT)` conta como AIR.
- Eixo Y para cima. Unidades de física: blocos e segundos.

Cada módulo exporta EXATAMENTE as assinaturas abaixo — `js/main.js` já está escrito
contra elas. Não renomear, não mudar formato de retorno.

## js/world/ (frente A)

### noise.js
```js
export function makeNoise2D(seed) // -> (x, z) => valor em [-1, 1], determinístico p/ mesma seed
```
Simplex ou Perlin 2D implementado à mão (sem lib). Suave e contínuo.

### worldgen.js
```js
export function generateChunk(seed, cx, cz) // -> Uint8Array do chunk
```
- Heightmap por octaves de ruído (3–4 octaves), altura do terreno entre ~18 e ~40.
- Coluna: STONE até altura-4, DIRT até altura-1, topo GRASS; abaixo de y≈22 o topo vira SAND (praias).
- Árvores: determinísticas por posição (hash de seed+coords, sem Math.random), tronco WOOD 4–5 de altura + copa LEAVES 3×3×2; plantar somente com base local x,z em 2..13 para nunca cruzar borda de chunk.

### storage.js
```js
export async function openStorage()          // abre o IndexedDB (db "cubocraft", store "diffs")
export async function loadAllDiffs()         // -> { blocks, owners }, cada um Map<chunkKey, Map<blockIdx, valor>>
export function queueDiff(cx, cz, blockIdx, blockId, owner)  // acumula em memória
export async function flushDiffs()           // grava o acumulado; também auto-flush a cada 3s e em visibilitychange/pagehide
```
Registro no IndexedDB: uma entrada por chunk, key `chunkKey`, valor array de `[blockIdx, blockId, owner]`. O terceiro campo é omitido quando a célula não tem dono, e um registro antigo de 2 campos carrega como `Owner.NONE` — save gravado antes da posse continua válido. Última escrita vence dentro do mesmo bloco.

### world.js
```js
export class World {
  constructor(seed, diffs, owners)  // no formato de loadAllDiffs()
  getChunk(cx, cz)              // Uint8Array; gera sob demanda (worldgen) e aplica diffs; cacheia
  getBlock(wx, wy, wz)          // id; fora de Y -> AIR; chunk inexistente -> gera
  ownerOf(wx, wy, wz)           // Owner.NONE | PLAYER | BOT
  canEdit(wx, wy, wz, by)       // a célula é livre ou já é de `by`?
  setBlock(wx, wy, wz, id, by)  // escreve, marca `by` como dono, queueDiff, dirty; -> boolean
  isSolid(wx, wy, wz)           // barra passagem: nem AIR nem WATER
  isWater(wx, wy, wz)           // há água nesta célula
  isTargetable(wx, wy, wz)      // há qualquer bloco: o que a mira acerta
  surfaceHeight(wx, wz)         // y do primeiro bloco sólido de cima p/ baixo, -1 se nenhum
  dirty                         // Set<chunkKey> de chunks a re-meshear; consumidor faz clear
}
```
`setBlock` num bloco de borda também marca dirty o(s) chunk(s) vizinho(s) adjacentes.

**Posse (`Owner` em constants.js).** Quem escreve numa célula passa a ser dono dela, AIR inclusive; `setBlock` recusa — devolvendo `false`, sem efeito nenhum — a escrita de quem não é o dono. Terreno como saiu do worldgen é `NONE` e aceita os dois. É o que impede o jogador de derrubar (ou de tapar a porta d)a casa de um bot, e a obra de um bot de assentar por cima do que o jogador fez.

Como `setBlock` é o único ponto por onde o mundo muda, a regra vale para qualquer caminho de edição, presente ou futuro. Os dois chamadores reais passam quem são: `Interaction` escreve como `Owner.PLAYER`, `BuildJob` como `Owner.BOT`. Bloco recusado no meio de uma obra é descartado (a casa sai remendada) em vez de reenfileirado — o jogador não vai sair de lá, e a obra tem de acabar; `Village.planNear` ainda recusa antes o sítio cuja planta encoste em célula do jogador.

## js/render/ (frente B)

### Blocos que não são cubo

`isSolidBlock`, `isLiquid` e `isPlant` (constants.js) dividem os blocos em três comportamentos:

- **líquidos** (água, lava): atravessam-se, com empuxo na física (`inLiquid`); água vai para a malha translúcida, lava para a opaca — lava translúcida some contra o terreno;
- **plantas** (flores, capim, fogo): desenhadas como **duas placas cruzadas**, não como cubo — flor que ocupa um cubo inteiro é um bloco colorido, não uma flor. Malha própria, material com `alphaTest` (transparência ordenaria mal e faria a flor piscar atrás da grama) e `DoubleSide`. A célula do atlas fica com o **fundo vazado**, e por isso o ícone do hotbar precisa de um fundo próprio;
- **sólidos**: o resto.

O culling do mesher trata planta como vizinho vazio: sem isso, um capim encostado num bloco apagava a face dele e o terreno ficava com buracos.

### atlas.js
```js
export function createAtlas() // -> { texture, uvRect, swatch }
// texture: THREE.CanvasTexture com NearestFilter (pixel art), gerada proceduralmente num canvas
// uvRect(blockId, face) -> { u0, v0, u1, v1 }   face: 0=topo, 1=fundo, 2=lado
// swatch(blockId) -> data URL 16×16 da face mais reconhecível (hotbar)
```
Texturas 16×16 desenhadas por código (fillRect + ruído de tom): grama topo verde, grama lado (terra com franja verde), terra, pedra, areia, madeira (casca), folhas. GRASS: topo/lado/fundo distintos; demais podem repetir a mesma célula.

**Distinguibilidade é requisito, não estética.** Terra, madeira e a lateral da grama são todas marrons; se só a matiz as separar, o jogador jura que o hotbar não funciona. Cada material tem matiz própria **e** padrão próprio (pedrisco, estria vertical com nós, rachadura, granulado, cacho). O teste é a distância RGB mínima entre pares de células, que deve ficar bem acima de ~30.

### mesher.js
```js
export function buildChunkMesh(getBlock, cx, cz, uvRect)
// -> { opaque: G, water: G }, cada G = { positions, normals, uvs, indices } (TypedArrays)
// getBlock(wx, wy, wz) é um closure (cobre vizinhos de outros chunks)
```
Duas geometrias porque a água é translúcida e precisa de material próprio e ordem de desenho própria (ver "Água"). Face culling em três casos: sólido contra AR **ou contra água** emite; água contra ar emite; água contra água ou contra sólido, não. 4 vértices + 2 triângulos por face. Posições em coordenadas de MUNDO (não locais). Sem greedy meshing no v1.

### renderer.js
```js
export function createScene(canvas) // -> { renderer, scene, camera, sun, ambient }
// WebGLRenderer antialias, céu azul, fog linear casando com RENDER_RADIUS,
// luz ambiente + direcional, camera PerspectiveCamera fov 75 near 0.1 far 400,
// resize handler embutido

export class ChunkRenderer {
  constructor(scene, world, atlas)  // atlas = retorno de createAtlas()
  update(playerPos)                 // playerPos = {x, y, z}
}
```
**O tamanho vem do CSS, não do `window`.** O canvas mede 100% de um corpo preso à
área visível, e `createScene` lê `clientWidth`/`clientHeight` de volta — no iOS,
`window.innerHeight` conta a barra de endereço que aparece e some, e o jogo
renderizava mais alto que a tela, com o rodapé (hotbar e botões) por baixo dela.
Além do `resize`, ouve-se `orientationchange` (o Safari só reporta o tamanho novo um
instante depois, então mede-se duas vezes) e `visualViewport.resize`, que é o único
aviso quando a barra sobe ou desce. Em tela de toque (`pointer: coarse`), o
antialias sai e o pixel ratio é limitado a 1,5: o iPhone tem `devicePixelRatio` 3, e
render nove vezes maior que o necessário é o que sobra de framerate.
`RENDER_RADIUS` (constants.js) também cai de 4 para 3 no celular — 49 chunks em vez
de 81, e névoa e céu acompanham porque saem daquela mesma constante.

`update`: garante meshes dos chunks no raio (fila com orçamento ~2 chunks/frame, mais perto primeiro), re-mesheia os de `world.dirty` (prioridade máxima, consome e limpa o set), remove+dispose meshes além de RENDER_RADIUS+1. Um `THREE.Mesh` por chunk, material único com a textura do atlas.

### sky.js e weather.js — hora do dia e tempo

```js
export class Sky {
  constructor(scene, sun, ambient, t0)  // sun/ambient vêm de createScene
  update(dt, playerPos, escuro)         // cor do céu e da névoa, luzes, sol, lua, estrelas, nuvens
  phase        // 'manhã' | 'tarde' | 'noite'
  untilNext    // segundos até o próximo período
}
export class Weather {
  constructor(scene, rnd)
  update(dt, playerPos)
  kind         // 'limpo' | 'chuva' | 'neve'
  darkness     // quanto o tempo escurece o céu, em [0,1]
  onChange     // avisado na virada, para o recado na tela
}
```

Três períodos de 15 minutos (`PERIODO`), interpolados entre marcos de luz — corte seco de cor lê como bug de render. O sol nasce a leste e se põe no fim da tarde: o arco cabe nos dois primeiros períodos (`DIA_FRACAO`), não no ciclo inteiro. A noite escurece mas a ambiente não vai a zero, senão o jogo fica injogável em vez de escuro. Céu, nuvens e estrelas acompanham o jogador — o céu não tem borda.

As partículas do clima vivem numa caixa que anda com o jogador e reciclam quem chega embaixo: algumas centenas bastam para a tela inteira, e o custo não cresce com o mundo. Chuva e neve diferem em queda, deriva e tamanho, que é o que as distingue sem legenda.

**Nada nesses dois módulos altera o mundo, a física ou os bots** — só cor, posição e visibilidade. Dá para desligar sem quebrar o jogo.

## js/player/ (frente C)

### input.js
```js
export class Input {
  constructor(canvas)     // pointer lock ao clicar no canvas; ESC solta (nativo)
  isDown(code)            // ex.: isDown('KeyW'), por event.code — teclado OU tecla virtual
  consumeMouseDelta()     // -> { dx, dy } acumulado desde a última chamada, e zera
  onMouseButton(cb)       // cb(button) em mousedown SÓ quando pointer-locked (0 esq, 2 dir)
  onKeyPress(cb)          // cb(code) em keydown sem repeat
  get locked()            // pointer lock ativo?
  get active()            // pointer lock OU toque: é isto que o loop pergunta

  // o que o toque injeta (js/player/touch.js), e mais ninguém usa:
  setVirtualKey(code, down)   // tecla segurada sem teclado (o botão de pular é 'Space')
  addLook(dx, dy)             // arrasto do dedo no mesmo acumulador do mouse
  emitMouseButton(button)     // clique virtual pelo caminho do mousedown
  emitKeyPress(code)          // tecla virtual de um toque só
  setStick(forward, strafe)   // manche analógico em [-1,1]; get stick -> {forward,strafe}|null
  set touchActive(v)          // entra/sai do comando pelo dedo; sair solta tudo que estava preso
}
```

**Duas fontes de comando, uma só interface.** `locked` continua sendo pointer lock
de verdade e nada mais; quem quer saber se o jogador está jogando pergunta `active`.
Player, Interaction e View não sabem se o que chegou veio de teclado, mouse ou dedo
— o toque escreve pelo mesmo `isDown`/`consumeMouseDelta`/callbacks de sempre.

### touch.js — iPhone, iPad e Android
```js
export class TouchControls {
  constructor(input, { onMenu })  // liga as zonas e os botões de #touch no Input
  reset()                         // pausar no meio de um gesto não deixa dedo pendurado
}
export function stickVector(dx, dy, radius)  // -> { forward, strafe, run, dx, dy }
export function isTouchDevice()
export const STICK_RADIUS
```

O jogo nascia preso ao pointer lock. **No iPhone ele não existe** (no iPad, só com
trackpad): `requestPointerLock()` não fazia nada, `pointerlockchange` nunca vinha,
o overlay não sumia e `input.locked` ficava falso para sempre — o mundo renderizava
parado atrás do menu. Sem teclado não havia WASD, e sem botão direito não havia como
colocar bloco: faltavam todos os comandos, não um.

Metade esquerda anda (manche que nasce onde o polegar pousa; empurrado além de
`RUN_AT` vira `ShiftLeft` e corre), metade direita olha, e o toque curto e parado
dessa metade é clique esquerdo — mirar e quebrar são o mesmo gesto na cabeça de quem
joga. Botões de pular (tecla virtual `Space`, segurada), quebrar e colocar (repetem
enquanto apertados: um bloco por toque transformaria cavar em dezenas de toques),
trocar de câmera e voltar ao menu — este último é o ESC do celular, sem ele não há
como reabrir o painel nem chegar ao botão de recomeçar o mundo.

**O gesto começa no elemento e termina na janela.** `touchstart` é ouvido na zona
(`pointerdown`, no caso dos botões), mas o meio e o fim do gesto vão no `window`: o
polegar cruza a divisa das metades e escorrega para fora dos botões o tempo todo, e
um fim de gesto perdido significa jogador andando sozinho ou pulo preso para sempre.
`setPointerCapture` resolveria o mesmo, mas lança quando o ponteiro já sumiu — e a
exceção mataria o handler antes da ação.

**Manche e olhar são eventos de TOQUE, não pointer events** — e isto é o conserto do
travamento do iPad. Com dois dedos na tela, o `pointerId` do Safari não é de fiar: ao
levantar um deles, os que ficam podem ser renumerados, e o `pointerup` do manche
chega com um id que não é o que desceu. O gesto nunca era solto — jogador andando
para a frente para sempre — e a zona ficava reservada (`_stickId`) para um dedo que
não existia mais, então nem dedo novo pegava: controle travado. O `identifier` de um
`Touch` é o mesmo do `touchstart` ao `touchend`, e é por ele que cada papel é
roteado. Os botões continuam em pointer events (um botão é um toque só, e assim
respondem também ao trackpad de um iPad com teclado), mas cada um solta apenas o seu
`pointerId` — antes, levantar o polegar do manche largava o pulo junto.

**Duas redes por baixo:** `touchend`/`touchcancel` sem nenhum dedo restante na tela
solta tudo (manche, olhar, botões e as repetições), e `blur` faz o mesmo — trocar de
aba no meio de um gesto não devolve `touchend` nenhum, e voltar ao jogo já andando
era o mesmo defeito por outra porta.

`stickVector` é pura de propósito: é a única parte testável sem tela nem dedo, e é
onde mora a regra de que meio empurrão anda meia velocidade. O `Player` soma o
manche ao teclado e normaliza com `min(len, 1) / len` — a diagonal do teclado
continua não sendo mais rápida, e a força intermediária do analógico é respeitada.

A camada visual (`#touch` no HTML, `.tbtn` no CSS) só existe com `body.toque.jogando`:
o `display: none` fora disso garante que nenhum evento de dedo chegue ao jogo com o
menu aberto, sem um segundo interruptor no JS.

### physics.js
```js
export function moveEntity(world, entity, dt)
// entity: { pos: {x,y,z}, vel: {x,y,z}, width, height, onGround }
// pos = centro da BASE (pés). Aplica GRAVITY em vel.y, integra eixo a eixo
// (X, Z, depois Y) resolvendo colisão AABB contra blocos sólidos; define onGround.
```
AABB: `[pos.x ± width/2, pos.y .. pos.y+height, pos.z ± width/2]`. Compartilhado entre jogador e bots. Clampar dt implícito não é responsabilidade daqui (main clampa).

### raycast.js
```js
export function raycastVoxel(world, origin, dir, maxDist, hits?)
// -> { block: {x,y,z}, prev: {x,y,z}, normal: {x,y,z}, t } | null
// hits(world, x, y, z) decide o que o raio acerta; o padrão é bloco sólido
```
DDA (Amanatides & Woo). `block` = primeiro acerto; `prev` = célula anterior (candidata a receber o bloco); `t` = distância até a face, para quem precisa do ponto mirado (`origin + dir*t`) e não só da célula. A mira passa um `hits` que inclui a água (ver "Água").

### player.js
```js
export class Player {
  constructor(world, spawnPos)   // spawnPos = {x,y,z} (pés)
  update(dt, input)              // WASD relativo ao yaw, Space pula (se onGround), Shift corre
  get eyePos()                   // {x, y, z} = pos + altura dos olhos (1.62)
  yaw; pitch;                    // radianos; atualizados com consumeMouseDelta (pitch clampado ±89°)
  pos; vel;                      // como em physics.js; width 0.6, height 1.8
}
```
Velocidade andar 4.3, correr 5.6, pulo vel.y = 8.5. Usa `moveEntity`.

### interaction.js
```js
export class Interaction {
  constructor(world, player, scene, input)
  update()                 // raycast (alcance 6) a partir de eyePos na direção do olhar;
                           // move um LineSegments wireframe de destaque p/ o bloco mirado (ou esconde)
  selectedBlock            // id do bloco do hotbar (default GRASS)
}
```

**Nenhuma recusa silenciosa.** Clique que não faz nada é indistinguível de jogo quebrado. As duas recusas possíveis — não há bloco no alcance, e a cela ficaria dentro do jogador — dizem o motivo em `#toast`, e a mira ganha `.idle` quando não há alvo. O destaque do bloco mirado é branco com `depthTest: false`: um contorno preto translúcido desaparecia contra pedra e sombra. O alcance é 6 e não 5 porque com 5 o chão de um terreno que desce à frente cai a ~5,07 do olho e o clique morria calado.

**Mirar alto numa face lateral coloca em cima** (`_placementCell`). O destino normal é `prev`, a vizinha da face mirada. O bloco vai para o **topo do bloco mirado** em dois casos, ambos com face lateral:
1. `prev` é célula do jogador — o corpo dentro dela, ou ela a prumo dele dos pés para cima (você está colado na coluna);
2. o raio está subindo (`dir.y > 0`) e o ponto mirado cai na **metade de cima** da face (`hit.t` dá o ponto: `eye + dir*t`).

Se o topo estiver ocupado, cai de volta em `prev` — e se `prev` for do jogador, recusa com toast. Mirar na metade de baixo continua colocando ao lado: é assim que se estende parede na horizontal, inclusive acima da cabeça.

Sem isto, uma coluna à frente travava em exatamente 2 blocos: passados 2, o topo fica acima da linha do olho (1,62), a face de cima some da vista e só resta a lateral — cuja vizinha ou é o jogador (colado) ou é um bloco solto ao lado (de longe). O critério é onde se mira, não onde se está: a 2 blocos de distância a coluna sobe igual, sem colar nela. Faces de cima e de baixo nunca sobem — seria colocar do outro lado do bloco, fora de vista. O teto é o alcance de 6 medido do olho; daí pula-se em cima da coluna e continua.
Registra em `input.onMouseButton`: esquerdo quebra (`setBlock AIR`), direito coloca `selectedBlock` na célula que `_placementCell` escolher — as duas escritas como `Owner.PLAYER`, e a recusa por posse vira toast como qualquer outra. Registra em `input.onKeyPress`: Digit1..Digit6 selecionam GRASS..LEAVES e atualizam a classe `.active` nos elementos `#hotbar .slot` (data-block já no HTML). `say(msg)` é público: a View usa o mesmo toast para anunciar a câmera.

### view.js
```js
export class View {
  constructor(world, player, scene, input, onChange)
  cycle()                  // 1ª pessoa -> 3ª de trás -> 3ª de frente -> 1ª
  update(dt, camera)       // posiciona boneco e câmera; chamado todo frame, depois da física
  mode                     // FIRST | THIRD_BACK | THIRD_FRONT
  avatar                   // o boneco do jogador (createAvatar com o visual HEITOR)
}
```
Tecla **V** alterna (não F5: no navegador F5 recarrega a página). Em 1ª pessoa a câmera fica em `eyePos` e o boneco é `visible = false`. Em 3ª, a câmera anda até 4,2 blocos no contrário do olhar (ou no sentido dele, na de frente) — e o recuo é medido com o mesmo `raycastVoxel` da mira, parando 0,4 antes do primeiro bloco sólido. Sem isso a câmera entra na parede de trás e o jogador passa a ver o mundo por dentro do terreno sem entender por quê. Na câmera de frente, `rotation` vira meia volta e o pitch inverte, para o boneco ficar de cara para quem joga.

O boneco fica na `pos` do jogador (origem nos pés, como a física) com `rotation.y = yaw + π`: o rosto é a face +Z e o jogador com yaw 0 olha para -Z.

## js/bots/ (frente D)

### bot.js e botManager.js
```js
export class BotManager {
  constructor(scene, world, count)
  update(dt, playerPos)   // física de todos a cada frame; IA escalonada (cada bot pensa a cada ~0.3s, round-robin)
}
```
Bot: mesma física do jogador (`moveEntity` de `js/player/physics.js`), width 0.6 height 1.8.

### avatar.js
```js
export function createAvatar(name, color, overrides) // -> { group, animate(dt, speed, onGround, pitch) }
export const HEITOR                                  // o visual fixo do jogador
```
Boneco humanoide segmentado: cabeça 8×8×8, tronco 8×12×4, braços e pernas 4×12×4, em unidades `U = 1.8/32` — 32 U de altura para casar com a AABB do bot. Braços e pernas penduram de um `Group` no ombro/quadril, então giram como articulação. A skin é pixel art desenhada por código (canvas 2D, `NearestFilter`), uma textura por face, com o rosto na face **+Z** — que é a frente, porque o mesh é girado por `atan2(vel.x, vel.z)`.

**Duas caixas coloridas não têm frente.** De lado ou de costas o bot antigo era o mesmo borrão, e não dava para saber se vinha, ia ou estava parado. Cabeça, membros e rosto resolvem isso à distância em que a IA decide seguir (10 blocos).

Pele, cabelo, calça, sapato, olhar e padrão da roupa saem de um hash do **nome** — o mesmo nome dá sempre o mesmo boneco, entre sessões e máquinas, como o resto do projeto evita `Math.random`. A camisa vem do `color` do roster. `animate` faz a passada acompanhar a velocidade real (sem patinar), morrer quando o bot para, dar respiração e olhada no idle, e levantar os braços no ar. A fase inicial é aleatória por bot para não marcharem em sincronia. Com `pitch` (o jogador), a cabeça segue a mira em vez de vagar sozinha.

`overrides` fixa peças do visual, para um boneco que não é sorteado. Campos além das cores: `hoodie` (zíper inteiro na frente, bolso canguru e uma caixa de capuz caída atrás do pescoço — presa ao **tronco**, senão vira chapéu que gira com o rosto), `shorts` (a calça para na coxa e o resto da perna é pele), `glove` (a mão vira luva de boxe ocupando um terço do braço, com punho enfaixado), `sock` e `nameTag`. `HEITOR` é o visual do jogador: cabelo escuro curto, moletom preto, bermuda creme, tênis escuros, luvas vermelhas e sem nome flutuando — num boneco deste tamanho o que é reconhecível é roupa e silhueta, não rosto.

Para conferir a skin sem GPU: `dev/preview-avatar.html` desenha as próprias texturas do avatar numa vista ortográfica de frente e de costas.
### village.js e world/structures.js — as construções
```js
export function planStructure(kind, rnd)  // -> { kind, w, d, door, blocks: [[x,y,z,id]] }
export const STRUCTURE_KINDS              // cabana, palafita, torre, poco, roca, sobrado
export class Village { planNear(x, z) -> BuildJob|null; nearestDoor(x, z, max); structures }
export class BuildJob { step(dt, occupants) -> done; standPoint; progress }
```
`structures.js` é **puro** (sem THREE, world ou DOM): descreve blocos em coordenadas locais, com `y = 0` no piso. `blocks` traz o AR primeiro e os sólidos de baixo para cima — limpa-se o volume (uma árvore no meio arruinaria o interior) e depois monta-se, na ordem em que um pedreiro monta.

**A regra que manda em todas é caber gente dentro.** Vão de porta de 2 blocos, teto interno de 2, e degrau nunca maior que 1: o jogador tem 1,8 e sobe 1 bloco pulando, e o bot só pula quando há bloco à frente com 2 livres acima. Escada de 2 em 2 tranca os dois do lado de fora, e construção em que não se entra é cenário, não casa. Três defeitos que os testes pegaram e que valem como aviso: escada externa montada ao contrário, primeiro degrau do caracol tapando a porta, e alçapão de uma célula só deixando o fim da escada espremido sob a sacada.

`Village` guarda o que já existe: impede sítios sobrepostos (`SITE_MIN_DIST`), deixa `SPAWN_CLEAR` livre em volta do spawn, respeita `MAX_STRUCTURES` e mede o desnível do retângulo inteiro (`MAX_SLOPE`) antes de aprovar o terreno. `BuildJob` assenta `BLOCKS_PER_SECOND` blocos e preenche o alicerce descendo célula a célula atrás de apoio — **não** por `surfaceHeight`, que numa coluna com árvore devolve o topo da copa.

**Terreno inclinado e os degraus da porta.** `MAX_SLOPE` foi de 2 para 4 porque o censo do terreno da seed do jogo mostrou o sobrado com 12 sítios válidos num raio de 16 (95% recusados por inclinação) — era a razão de a aldeia fugir para longe. O piso é assentado acima do ponto mais ALTO do sítio, então tolerar mais desnível põe a soleira vários blocos acima do lado de baixo, e o jogador sobe 1 por pulo: `DOOR_STEPS` desce um degrau por bloco de afastamento a partir da porta até encontrar o chão. Sem eles, tolerar terreno acidentado significaria casa em que não se entra. Os degraus entram no FIM da fila, para nenhuma limpeza da planta apagá-los.

**A aldeia é salva.** `loadVillage()`/`saveVillage()` guardam a lista de construções prontas numa store própria do IndexedDB (versão 2 do banco, migração aditiva — save antigo só ganha a store nova). Sem isso a aldeia nascia vazia a cada carregamento e tentava erguer as seis de novo: as antigas continuavam no mundo ocupando o espaço perto do spawn, as novas eram empurradas para 30 blocos, e o jogador via sempre as mesmas de perto. Só obra **pronta** é gravada — canteiro salvo viraria, na volta, uma casa pela metade que ninguém termina. `Village.tick()`, chamado pelo BotManager, dispara a gravação quando uma obra acaba.

**A aldeia é uma lista de pendências.** `MAX_STRUCTURES` é o número de tipos: sai **uma de cada**, nunca repetida, e `pending` diz o que falta. O sorteio uniforme anterior dava três poços numa aldeia de quatro — o poço é a menor planta e por isso a que mais passa nos testes de terreno. `_kindOrder` põe casa antes de poço e roça, e `planNear` tenta os pendentes em ordem: antes, um tipo azarado custava a obra inteira daquela decisão. O tipo que não acha lugar acumula recusa em `_fails` e vai afrouxando o **próprio** raio, de `VILLAGE_RADIUS` até `VILLAGE_RADIUS_MAX`; sem isso o sobrado, que exige o maior retângulo plano, simplesmente não era construído. `nearest(x, z)` alimenta a bússola da HUD e prefere obra em andamento a casa pronta.

**A aldeia mora perto do spawn.** `VILLAGE_RADIUS` é o teto; `_searchCenter` puxa o centro de busca para dentro de metade desse raio antes de sortear o sítio. O bot pede obra de onde ele está, e ele vagueia — sem a correção a aldeia se espalhava atrás dele e nascia a 40 ou 50 blocos, que foi queixa real de quem jogou. A folga do spawn mede a **beirada** da construção (uma casa larga centrada a 7 tem parede a 3); o raio da aldeia mede o centro. Quem caminha até o canteiro é o bot.

**Obra que não termina é pior que obra torta.** Bloco que cairia sobre uma entidade viva volta para o fim da fila — mas só `ADIAMENTOS_MAX` vezes; depois é assentado e quem estava ali sobe para cima dele. Sem esse limite, alguém parado no lugar congelava a casa para sempre, e o culpado mais comum era o próprio pedreiro: `standPoint` agora fica fora de **toda** a planta (`footprint`), não só à frente da porta, porque varanda, beiral e o primeiro degrau avançam além da soleira. O registro da construção guarda o `job`, e `built` são as prontas — antes a aldeia dava por construída uma casa no instante em que o sítio era escolhido, e mandava bot visitar canteiro vazio.

### Água (`Blocks.WATER`)

Primeiro bloco que não é parede, e por isso toca em quatro lugares que perguntavam "é AIR?":

- **`isSolid`** exclui a água, então física, raycast padrão e a busca de apoio do alicerce a atravessam. `surfaceHeight` também a ignora: ela devolve a altura do **chão**, e é dela que saem o spawn e o piso das construções — casa assentada na superfície de um lago não fica de pé.
- **A mira** usa um predicado próprio (`isTargetable`) e acerta a água; sem isso o clique atravessava a piscina e ia bater no fundo, e não haveria como esvaziá-la. A saída de emergência da origem do raycast continua olhando só para sólido: ela existe para o olho preso dentro de geometria, e se respondesse à água quem estivesse nadando miraria a própria célula a cada clique.
- **O mesher** devolve duas geometrias, `opaque` e `water`. Sólido contra água emite face (é a parede da piscina vista de dentro); água contra ar emite; água contra água ou contra sólido, não. O material da água é translúcido, `DoubleSide` e **sem `depthWrite`** — com profundidade escrita, a face da frente apagava a de trás e o volume virava uma chapa azul.
- **A física** dá empuxo: `WATER_GRAVITY`, `WATER_SINK` e `WATER_DRAG` em `physics.js`, e o Espaço vira `SWIM_UP` enquanto `inWater` — pulo só sai do chão, nadar não.

FSM: `idle` (2–4s) → `build` (procura sítio; sem terreno, volta a vaguear) → `visit` (vai à porta e **entra**, porque parar na soleira é ficar de fora) → `wander` (escolhe ponto a até 12 blocos, steering na direção, pula se `onGround` e bloqueado à frente, desiste após ~6s) → `follow` (se jogador a <10 blocos, 30% de chance ao decidir; para a 2 blocos). Spawn: em círculo de raio ~10 ao redor do spawn do jogador, em `world.surfaceHeight + 1`. Nomes fixos: Ana, Beto, Caio. O mesh é orientado na direção do movimento.

## Boot (js/main.js — já escrito, frentes não tocam)

```
openStorage → loadAllDiffs → new World → createScene → createAtlas → ChunkRenderer
→ spawn em (8.5, surfaceHeight+1, 8.5) → Player, Input, Interaction, BotManager(3)
→ TouchControls (só em tela de toque)
→ loop rAF: dt clampado a 0.05s; player.update, interaction.update, bots.update,
  chunkRenderer.update, view.update (boneco + câmera), render
```

O loop anda quando `input.active` — pointer lock **ou** dedo. Começar o jogo é pedir
o lock (mouse) ou marcar `touchActive` e esconder o overlay (toque); o `touchend` do
overlay é tratado além do `click` porque no iOS o clique num div vem tarde e às
vezes não vem.

**Sem IndexedDB o jogo roda assim mesmo.** Abrir o banco falha no Safari em navegação
privada, e o `throw` no boot trocava o jogo inteiro pela tela de erro. Perder o save
é ruim; não poder jogar é pior: as três chamadas de carga ficam num `try`, o mundo
nasce vazio de diffs e o jogador é avisado por toast quando entra.

## tests/ — regressão da interação

```sh
node tests/run.mjs      # sem dependências, sem package.json; sai != 0 se algo falhar
```

`run.mjs` registra um hook que resolve o especificador nu `three` para `lib/three.module.js` — o mesmo que o importmap do `index.html` faz no browser. Por isso os testes carregam os **arquivos reais** (`interaction.js`, `raycast.js`, `player.js`, `physics.js`, `world.js`), em vez de uma cópia da lógica. `harness.mjs` só monta cenário: mundo plano, `Player` e `Interaction` de verdade ligados a um input falso, e uma mira que varre o pitch como o jogador varre olhando o destaque.

**Nada de constante duplicada no teste.** Altura do olho, alcance e força do pulo são descobertos rodando o código; um teste que reimplementa a regra passa a validar a cópia e deixa o jogo quebrar em paz.

Cobertura, em ordem do que dói mais perder: coluna à frente passa de 2 blocos (o bug), sobe de qualquer distância (0 a 2 blocos de folga), sobe acima da cabeça sem virar bloco solto ao lado, mirar a metade de baixo continua colocando ao lado, topo ocupado não sobrescreve, clique sem lugar é recusado, nenhum ângulo coloca bloco dentro do jogador (varredura de yaw × pitch), faces de cima e de baixo nunca sobem, pilar por pulo continua subindo, quebrar continua quebrando o bloco mirado, e o contrato do raycast (`t` cai no plano da face, `prev` = `block + normal` e nunca é sólida).

Verificado que a suíte acusa: desligando `_isSideFace`, caem os 3 testes de empilhar e mais nenhum.

`touch.test.mjs` cobre o que dá para afirmar sem tela nem dedo, que é justamente o
que estava quebrado: a conta do manche (zona morta, frente é para cima, corrida no
fim do curso, força cheia limitada a 1), o Input assumindo o comando **sem** pointer
lock, a tecla virtual do pular tirando o jogador do chão, o arrasto virando olhada, o
clique virtual quebrando o bloco mirado, o hotbar tocável escolhendo bloco pelo mesmo
caminho das teclas 1–9, e pausar soltando tudo que o dedo segurava. O `Input` real é
usado (não um dublê): o `stubDom` do harness ganhou `addEventListener` para isso.
