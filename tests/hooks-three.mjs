// Resolve o especificador nu "three" para lib/three.module.js — o mesmo que o
// importmap do index.html faz no browser. Sem isto, os módulos que importam
// three (interaction.js, renderer.js) não carregam fora do browser, e os testes
// teriam de reimplementar a lógica em vez de exercitar o arquivo real.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('../lib/three.module.js', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
