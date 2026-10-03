import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMigracoes, limparSql, linhaDe } from "./_migracoes.ts";

// CONTRATO
// Faz: impede datas dependentes do fuso da sessão no SQL e nas funções.
// Ignora comentários e literais, preservando offsets para arquivo:linha.
// Exceção: somente 0010_cofrinhos.sql:31, corrigida pela 0019:460.
// Uma exceção sem ocorrência também falha, para não virar permissão obsoleta.
// Vermelho e verde: casos sintéticos abaixo exercitam o mesmo detector do gate.

interface EntradaMigracao {
  arquivo: string;
  sql: string;
  bruto: string;
}

interface Ocorrencia {
  arquivo: string;
  linha: number;
  expressao: string;
}

interface Excecao {
  arquivo: string;
  linha: number;
  motivo: string;
}

const ALLOWLIST: Excecao[] = [{
  arquivo: "0010_cofrinhos.sql",
  linha: 31,
  motivo: "Default current_date de movimentacoes_cofrinho.data sobrescrito " +
    "por 0019_correcoes_auditoria_graph_loop.sql:460.",
}];

function ocorrencias(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const resultado: Ocorrencia[] = [];
  for (const m of migracoes) {
    const procurar = (sql: string, offset: number) => {
      const re = /\b(?:current_date|now\s*\(\s*\)\s*::\s*date|current_timestamp\s*::\s*date|localtimestamp|localtime)\b/gi;
      let achado: RegExpExecArray | null;
      while ((achado = re.exec(sql)) !== null) {
        resultado.push({
          arquivo: m.arquivo,
          linha: linhaDe(m.bruto, offset + achado.index),
          expressao: achado[0],
        });
      }
    };
    procurar(m.sql, 0);

    // No SQL limpo os corpos estão apagados, mas seus delimitadores ficam.
    // Extraímos apenas AS de CREATE FUNCTION, evitando tratar um literal
    // dollar-quoted comum como SQL executável. limparSql no miolo remove
    // comentários (inclusive blocos aninhados) e literais da própria função.
    const funcoes = /\bcreate\s+(?:or\s+replace\s+)?function\b[^;]*/gi;
    let funcao: RegExpExecArray | null;
    while ((funcao = funcoes.exec(m.sql)) !== null) {
      const corpo = /\bas\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$|')/i.exec(funcao[0]);
      if (corpo === null) continue;
      const delimitador = corpo[1];
      const inicio = funcao.index + corpo.index + corpo[0].length;
      let fim = m.bruto.indexOf(delimitador, inicio);
      // AS '...' também é um corpo de função válido. Aspas duplicadas
      // continuam literais quando o corpo é decodificado.
      if (delimitador === "'") {
        while (fim !== -1 && m.bruto[fim + 1] === "'") {
          fim = m.bruto.indexOf("'", fim + 2);
        }
      }
      if (fim === -1) continue;
      const bruto = m.bruto.slice(inicio, fim);
      // Mantém dois caracteres por aspa escapada para preservar offsets.
      const decodificado = delimitador === "'" ? bruto.replace(/''/g, "' ") : bruto;
      procurar(limparSql(decodificado), inicio);
    }
  }
  return resultado;
}

function problemas(migracoes: EntradaMigracao[], allowlist: Excecao[] = []): string[] {
  const achados = ocorrencias(migracoes);
  const casa = (e: Excecao, o: Ocorrencia) =>
    e.arquivo === o.arquivo && e.linha === o.linha;
  return [
    ...achados.filter((o) => !allowlist.some((e) => casa(e, o)))
      .map((o) => `${o.arquivo}:${o.linha} -> ${o.expressao}`),
    ...allowlist.filter((e) => !achados.some((o) => casa(e, o)))
      .map((e) => `${e.arquivo}:${e.linha} -> exceção obsoleta: ${e.motivo}`),
  ];
}

function sintetica(bruto: string): EntradaMigracao[] {
  return [{ arquivo: "0001_sintetica.sql", bruto, sql: limparSql(bruto) }];
}

test("detector de fuso: current_date em código falha com arquivo e linha", () => {
  assert.deepEqual(problemas(sintetica("-- cabeçalho\nselect current_date;")),
    ["0001_sintetica.sql:2 -> current_date"]);
});

test("detector de fuso: corpo de função não escapa", () => {
  assert.deepEqual(problemas(sintetica(
    "create function f() returns date language sql as $corpo$\nselect current_date;\n$corpo$;",
  )), ["0001_sintetica.sql:2 -> current_date"]);
});

test("detector de fuso: variantes proibidas e espaços são reconhecidos", () => {
  for (const expressao of ["CURRENT_DATE", "now ( ) :: date", "current_timestamp :: date", "localtimestamp(2)", "localtime"]) {
    assert.equal(ocorrencias(sintetica(`select ${expressao};`)).length, 1, expressao);
    assert.equal(ocorrencias(sintetica(
      `create function f() returns date as $$ select ${expressao}; $$ language sql;`,
    )).length, 1, expressao);
  }
});

test("detector de fuso: comentários e literais são verdes dentro e fora de funções", () => {
  const sql = "-- current_date\n/* current_date /* localtime */ */\n" +
    "select 'current_date', 'as ''current_date''', '/*', '--';";
  assert.deepEqual(problemas(sintetica(sql)), []);
  assert.deepEqual(problemas(sintetica(
    `create function f() returns text as $$ ${sql} $$ language sql;`,
  )), []);
  assert.deepEqual(problemas(sintetica("select $literal$current_date$literal$;")), []);
});

test("detector de fuso: data explícita de São Paulo é verde", () => {
  const sql = "select (now() at time zone 'America/Sao_Paulo')::date;";
  assert.deepEqual(problemas(sintetica(sql)), []);
  assert.deepEqual(problemas(sintetica(
    `create function f() returns date language sql as $$ ${sql} $$;`,
  )), []);
});

test("detector de fuso: allowlist é exata e não pode ficar obsoleta", () => {
  const excecao = [{ arquivo: "0001_sintetica.sql", linha: 1, motivo: "caso sintético" }];
  assert.deepEqual(problemas(sintetica("select current_date;"), excecao), []);
  assert.match(problemas(sintetica("select 1;"), excecao)[0], /exceção obsoleta/);
  assert.equal(problemas(sintetica("\nselect current_date;"), excecao).length, 2);
});

test("migrações reais: datas usam America/Sao_Paulo", () => {
  assert.deepEqual(problemas(lerMigracoes(), ALLOWLIST), [],
    "SQL deve usar (now() at time zone 'America/Sao_Paulo')::date. " +
    "Corrija a ocorrência indicada em arquivo:linha; não amplie a allowlist.");
});
