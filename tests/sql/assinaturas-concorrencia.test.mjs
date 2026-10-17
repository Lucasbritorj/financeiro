import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Aceita exclusivamente o container Supabase local deste projeto.
const container = 'supabase_db_financeiro-web';
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
function sql(input) { return execFileSync('docker', args, { input, encoding: 'utf8', timeout: 15000 }); }
function claims(uid) { return `select set_config('request.jwt.claims','{"sub":"${uid}"}',true);`; }

test('exclusão concorrente não deixa assinatura ligada a cartão excluído', async () => {
  const uid = randomUUID();
  sql(`insert into auth.users(id,email) values('${uid}','${uid}@concorrencia.local.test');`);
  let primeira;
  let fimPrimeira;
  try {
    const cartao = sql(`begin; ${claims(uid)} select public.criar_cartao('Concorrência',100000,10,20)->>'cartao_id'; commit;`).trim().split('\n').at(-1);
    assert.match(cartao, /^[a-f0-9-]{36}$/);
    primeira = spawn('docker', args);
    let saida = '';
    let falha = '';
    fimPrimeira = new Promise((resolve, reject) => {
      primeira.once('error', reject);
      primeira.once('close', code => code === 0 ? resolve() : reject(new Error(falha)));
    });
    const travada = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sessão local não atingiu a trava.')), 10000);
      primeira.stdout.on('data', chunk => { saida += chunk; if (saida.includes('TRAVADO')) { clearTimeout(timer); resolve(); } });
      primeira.once('close', () => { clearTimeout(timer); if (!saida.includes('TRAVADO')) reject(new Error(falha)); });
    });
    primeira.stderr.on('data', chunk => { falha += chunk; });
    primeira.stdin.end(`begin; ${claims(uid)} select public.excluir_cartao('${cartao}'); select 'TRAVADO'; select pg_sleep(2); commit;`);
    await travada;
    // Esta chamada deve aguardar a exclusão e recusar o cartão; a versão sem
    // trava via a versão antiga da linha e criava um vínculo logicamente inválido.
    let recusada = false;
    try {
      sql(`begin; ${claims(uid)} select public.criar_assinatura('Plano concorrente',1000,'MENSAL',current_date+1,null,'${cartao}'); commit;`);
    } catch (error) {
      assert.match(error.stderr.toString(), /FW404/);
      recusada = true;
    }
    await fimPrimeira;
    assert.equal(recusada, true, 'Assinatura foi criada com cartão excluído.');
    assert.equal(sql(`select count(*) from public.recorrencias where user_id='${uid}' and cartao_id='${cartao}';`).trim(), '0');
  } finally {
    if (primeira && primeira.exitCode === null) { primeira.kill(); await fimPrimeira?.catch(() => {}); }
    sql(`delete from auth.users where id='${uid}';`);
  }
});
