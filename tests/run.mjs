// Rodar: node tests/run.mjs
//
// Sem dependências e sem package.json: os testes carregam os módulos do jogo tal
// como o browser carrega, com o especificador "three" resolvido por um hook que
// espelha o importmap do index.html.
//
// Tudo abaixo é import dinâmico de propósito: import estático é içado para antes
// do corpo do módulo, e aí o hook ainda não estaria registrado.

import { register } from 'node:module';

register(new URL('./hooks-three.mjs', import.meta.url), import.meta.url);

const { runAll } = await import('./tiny-test.mjs');
const { stubDom } = await import('./harness.mjs');
stubDom();

console.log('CuboCraft — testes\n');
await import('./raycast.test.mjs');
await import('./placement.test.mjs');
await import('./avatar.test.mjs');
await import('./structures.test.mjs');
await import('./bots.test.mjs');
await import('./ownership.test.mjs');

process.exit((await runAll()) === 0 ? 0 : 1);
