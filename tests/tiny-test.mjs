// Runner mínimo: registra casos, roda em ordem, conta falhas. Sem dependências —
// o projeto não tem package.json e não vai ganhar um por causa de teste.

const cases = [];

export const test = (name, fn) => cases.push({ name, fn });

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'asserção falhou');
}

export function assertEqual(got, want, msg) {
  if (got !== want) throw new Error(`${msg || 'valor'}: ${JSON.stringify(got)} (esperado ${JSON.stringify(want)})`);
}

export async function runAll() {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log(`  ok    ${c.name}`);
    } catch (err) {
      failed++;
      console.log(`  FALHA ${c.name}\n          ${err.message}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passaram`);
  return failed;
}
