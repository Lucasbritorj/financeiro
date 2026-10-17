import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';

test('instala assinaturas sobre a versão já publicada, sem reordenar histórico', { timeout: 60000 }, async () => {
  const container = execFileSync('docker', ['run', '-d', '--network', 'none', '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=app', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  try {
    let pronto = false;
    for (let tentativa = 0; tentativa < 30; tentativa++) {
      try { execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'app'], { stdio: 'ignore' }); pronto = true; break; }
      catch { await esperar(500); }
    }
    assert.ok(pronto, 'Postgres isolado não iniciou.');
    const pendentes = ['20261006120000_central_assinaturas.sql', '20261007120000_corrigir_central_assinaturas.sql', '20261016210000_integrar_assinaturas_cadastros.sql'];
    const migracoes = readdirSync('supabase/migrations').filter(nome => nome.endsWith('.sql')).sort();
    const novas = migracoes.filter(nome => nome > '20261016210000_integrar_assinaturas_cadastros.sql');
    const ordem = [...migracoes.filter(nome => !pendentes.includes(nome) && !novas.includes(nome)), ...pendentes, ...novas];
    assert.ok(ordem.indexOf('20261016200000_editar_cadastros.sql') < ordem.indexOf(pendentes[0]));
    const entrada = readFileSync('tests/sql/00_shim_auth.sql', 'utf8') + '\n' + ordem.map(nome => readFileSync(`supabase/migrations/${nome}`, 'utf8')).join('\n');
    const comando = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'app', '-v', 'ON_ERROR_STOP=1', '-q'];
    execFileSync('docker', comando, { input: entrada, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    const arquivos = readdirSync('supabase/tests').filter(nome => nome.endsWith('.sql')).sort();
    assert.ok(arquivos.length > 0, 'Nenhum arquivo de assert encontrado.');
    const resultado = spawnSync('docker', comando, { input: arquivos.map(nome => readFileSync(`supabase/tests/${nome}`, 'utf8')).join('\n'), encoding: 'utf8', timeout: 30000 });
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.equal((resultado.stderr.match(/NOTICE:\s+OK:/g) ?? []).length, arquivos.length, 'Faltou confirmação de sucesso de algum arquivo de assert.');
    console.log(`Upgrade real: ${ordem.length} migrações; ${arquivos.length} arquivos de asserts executados sem erro.`);
  } finally { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); }
});
