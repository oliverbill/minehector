# CuboCraft — arquitetura e contratos entre módulos

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
export async function loadAllDiffs()         // -> Map<chunkKey, Map<blockIdx, blockId>>
export function queueDiff(cx, cz, blockIdx, blockId)  // acumula em memória
export async function flushDiffs()           // grava o acumulado; também auto-flush a cada 3s e em visibilitychange/pagehide
```
Registro no IndexedDB: uma entrada por chunk, key `chunkKey`, valor serializável (objeto/array simples). Última escrita vence dentro do mesmo bloco.

### world.js
```js
export class World {
  constructor(seed, diffs)      // diffs no formato de loadAllDiffs()
  getChunk(cx, cz)              // Uint8Array; gera sob demanda (worldgen) e aplica diffs; cacheia
  getBlock(wx, wy, wz)          // id; fora de Y -> AIR; chunk inexistente -> gera
  setBlock(wx, wy, wz, id)      // escreve no chunk, chama queueDiff, marca dirty
  isSolid(wx, wy, wz)           // id !== AIR (todos os blocos v1 são sólidos)
  surfaceHeight(wx, wz)         // y do primeiro bloco sólido de cima p/ baixo, -1 se nenhum
  dirty                         // Set<chunkKey> de chunks a re-meshear; consumidor faz clear
}
```
`setBlock` num bloco de borda também marca dirty o(s) chunk(s) vizinho(s) adjacentes.

## js/render/ (frente B)

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
// -> { positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array }
// getBlock(wx, wy, wz) é um closure (cobre vizinhos de outros chunks)
```
Face culling: emite face só se o vizinho na direção dela for AIR. 4 vértices + 2 triângulos por face. Posições em coordenadas de MUNDO (não locais). Sem greedy meshing no v1.

### renderer.js
```js
export function createScene(canvas) // -> { renderer, scene, camera }
// WebGLRenderer antialias, céu azul, fog linear casando com RENDER_RADIUS,
// luz ambiente + direcional, camera PerspectiveCamera fov 75 near 0.1 far 400,
// resize handler embutido

export class ChunkRenderer {
  constructor(scene, world, atlas)  // atlas = retorno de createAtlas()
  update(playerPos)                 // playerPos = {x, y, z}
}
```
`update`: garante meshes dos chunks no raio (fila com orçamento ~2 chunks/frame, mais perto primeiro), re-mesheia os de `world.dirty` (prioridade máxima, consome e limpa o set), remove+dispose meshes além de RENDER_RADIUS+1. Um `THREE.Mesh` por chunk, material único com a textura do atlas.

## js/player/ (frente C)

### input.js
```js
export class Input {
  constructor(canvas)     // pointer lock ao clicar no canvas; ESC solta (nativo)
  isDown(code)            // ex.: isDown('KeyW'), por event.code
  consumeMouseDelta()     // -> { dx, dy } acumulado desde a última chamada, e zera
  onMouseButton(cb)       // cb(button) em mousedown SÓ quando pointer-locked (0 esq, 2 dir)
  onKeyPress(cb)          // cb(code) em keydown sem repeat
  get locked()            // pointer lock ativo?
}
```

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
export function raycastVoxel(world, origin, dir, maxDist)
// -> { block: {x,y,z}, prev: {x,y,z}, normal: {x,y,z}, t } | null
```
DDA (Amanatides & Woo). `block` = primeiro sólido atingido; `prev` = célula anterior (candidata a receber o bloco); `t` = distância até a face, para quem precisa do ponto mirado (`origin + dir*t`) e não só da célula.

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
Registra em `input.onMouseButton`: esquerdo quebra (`setBlock AIR`), direito coloca `selectedBlock` na célula que `_placementCell` escolher. Registra em `input.onKeyPress`: Digit1..Digit6 selecionam GRASS..LEAVES e atualizam a classe `.active` nos elementos `#hotbar .slot` (data-block já no HTML).

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
export function createAvatar(name, color) // -> { group, animate(dt, speed, onGround) }
```
Boneco humanoide segmentado: cabeça 8×8×8, tronco 8×12×4, braços e pernas 4×12×4, em unidades `U = 1.8/32` — 32 U de altura para casar com a AABB do bot. Braços e pernas penduram de um `Group` no ombro/quadril, então giram como articulação. A skin é pixel art desenhada por código (canvas 2D, `NearestFilter`), uma textura por face, com o rosto na face **+Z** — que é a frente, porque o mesh é girado por `atan2(vel.x, vel.z)`.

**Duas caixas coloridas não têm frente.** De lado ou de costas o bot antigo era o mesmo borrão, e não dava para saber se vinha, ia ou estava parado. Cabeça, membros e rosto resolvem isso à distância em que a IA decide seguir (10 blocos).

Pele, cabelo, calça, sapato, olhar e padrão da roupa saem de um hash do **nome** — o mesmo nome dá sempre o mesmo boneco, entre sessões e máquinas, como o resto do projeto evita `Math.random`. A camisa vem do `color` do roster. `animate` faz a passada acompanhar a velocidade real (sem patinar), morrer quando o bot para, dar respiração e olhada no idle, e levantar os braços no ar. A fase inicial é aleatória por bot para não marcharem em sincronia.

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

`Village` guarda o que já existe: impede sítios sobrepostos (`SITE_MIN_DIST`), deixa `SPAWN_CLEAR` livre em volta do spawn, respeita `MAX_STRUCTURES` e mede o desnível do retângulo inteiro (`MAX_SLOPE`) antes de aprovar o terreno. `BuildJob` assenta `BLOCKS_PER_SECOND` blocos e preenche o alicerce descendo célula a célula atrás de apoio — **não** por `surfaceHeight`, que numa coluna com árvore devolve o topo da copa. Bloco que cairia sobre uma entidade viva volta para o fim da fila: sem isso a obra emparedava quem estivesse na soleira, inclusive o próprio pedreiro.

FSM: `idle` (2–4s) → `build` (procura sítio; sem terreno, volta a vaguear) → `visit` (vai à porta e **entra**, porque parar na soleira é ficar de fora) → `wander` (escolhe ponto a até 12 blocos, steering na direção, pula se `onGround` e bloqueado à frente, desiste após ~6s) → `follow` (se jogador a <10 blocos, 30% de chance ao decidir; para a 2 blocos). Spawn: em círculo de raio ~10 ao redor do spawn do jogador, em `world.surfaceHeight + 1`. Nomes fixos: Ana, Beto, Caio. O mesh é orientado na direção do movimento.

## Boot (js/main.js — já escrito, frentes não tocam)

```
openStorage → loadAllDiffs → new World → createScene → createAtlas → ChunkRenderer
→ spawn em (8.5, surfaceHeight+1, 8.5) → Player, Input, Interaction, BotManager(3)
→ loop rAF: dt clampado a 0.05s; player.update, interaction.update, bots.update,
  chunkRenderer.update, camera segue eyePos/yaw/pitch, render
```

## tests/ — regressão da interação

```sh
node tests/run.mjs      # sem dependências, sem package.json; sai != 0 se algo falhar
```

`run.mjs` registra um hook que resolve o especificador nu `three` para `lib/three.module.js` — o mesmo que o importmap do `index.html` faz no browser. Por isso os testes carregam os **arquivos reais** (`interaction.js`, `raycast.js`, `player.js`, `physics.js`, `world.js`), em vez de uma cópia da lógica. `harness.mjs` só monta cenário: mundo plano, `Player` e `Interaction` de verdade ligados a um input falso, e uma mira que varre o pitch como o jogador varre olhando o destaque.

**Nada de constante duplicada no teste.** Altura do olho, alcance e força do pulo são descobertos rodando o código; um teste que reimplementa a regra passa a validar a cópia e deixa o jogo quebrar em paz.

Cobertura, em ordem do que dói mais perder: coluna à frente passa de 2 blocos (o bug), sobe de qualquer distância (0 a 2 blocos de folga), sobe acima da cabeça sem virar bloco solto ao lado, mirar a metade de baixo continua colocando ao lado, topo ocupado não sobrescreve, clique sem lugar é recusado, nenhum ângulo coloca bloco dentro do jogador (varredura de yaw × pitch), faces de cima e de baixo nunca sobem, pilar por pulo continua subindo, quebrar continua quebrando o bloco mirado, e o contrato do raycast (`t` cai no plano da face, `prev` = `block + normal` e nunca é sólida).

Verificado que a suíte acusa: desligando `_isSideFace`, caem os 3 testes de empilhar e mais nenhum.
