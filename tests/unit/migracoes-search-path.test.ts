import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMigracoes, limparSql, linhaDe } from "./_migracoes.ts";

// O CLAUDE.md deste projeto manda, para toda RPC de escrita nova: "definer +
// search_path + escopo em código + revoke execute de public/anon + grant a
// authenticated". A parte do search_path é a que falha em silêncio.
//
// Função SECURITY DEFINER roda com o privilégio de quem a criou. Se ela não
// fixa search_path, quem chama controla em que schema os nomes não-qualificados
// resolvem — e passa a executar código próprio com privilégio alheio. É
// escalada de privilégio clássica em Postgres, e o Supabase advisor sinaliza
// como vulnerabilidade.
//
// Contagem bruta dava 67 ocorrências de `security definer` contra 66 de `set
// search_path`. Contagem não prova pareamento: as duas podem estar em funções
// diferentes. Só parser responde, e é por isso que este gate existe.

interface Ocorrencia {
  nome: string;
  arquivo: string;
  linha: number;
}

interface EntradaMigracao {
  numero: number;
  arquivo: string;
  sql: string;
}

/**
 * Statement inteiro a partir de `inicio`.
 *
 * O corpo dollar-quoted já veio em branco, então o primeiro `;` é o fim do
 * CREATE FUNCTION e não um `;` de dentro da função. Os atributos (`language`,
 * `security definer`, `set search_path`) sempre vêm antes do corpo, então
 * mesmo um corpo em sintaxe `begin atomic` — que teria `;` de verdade — só
 * encurtaria a região DEPOIS do que interessa.
 */
function statementEm(sql: string, inicio: number): string {
  const fim = sql.indexOf(";", inicio);
  return fim === -1 ? sql.slice(inicio) : sql.slice(inicio, fim + 1);
}

export function definerSemSearchPath(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const achados: Ocorrencia[] = [];

  for (const m of migracoes) {
    const re = /\bcreate\s+(?:or\s+replace\s+)?function\s+([^\s(]+)/gi;
    let achado: RegExpExecArray | null;
    while ((achado = re.exec(m.sql)) !== null) {
      const statement = statementEm(m.sql, achado.index);
      if (!/\bsecurity\s+definer\b/i.test(statement)) continue;
      if (/\bset\s+search_path\b/i.test(statement)) continue;

      achados.push({
        nome: achado[1],
        arquivo: m.arquivo,
        linha: linhaDe(m.sql, achado.index),
      });
    }
  }

  return achados;
}

function sintetica(numero: number, sql: string): EntradaMigracao {
  return {
    numero,
    arquivo: `${String(numero).padStart(4, "0")}_sintetica.sql`,
    sql: limparSql(sql),
  };
}

test("detector: definer sem search_path é violação", () => {
  const achados = definerSemSearchPath([
    sintetica(
      1,
      "create function public.f() returns void language plpgsql security definer as $$ begin end; $$;",
    ),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].nome, "public.f");
});

test("detector: definer com set search_path passa", () => {
  const achados = definerSemSearchPath([
    sintetica(
      1,
      "create function public.f() returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;",
    ),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: função sem definer não é cobrada", () => {
  const achados = definerSemSearchPath([
    sintetica(1, "create function public.f() returns void language sql as $$ select 1; $$;"),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: search_path de uma função não cobre a função seguinte", () => {
  // É exatamente o que a contagem bruta não sabia distinguir: 67 contra 66
  // ficaria "quase certo" mesmo com o par trocado de lugar.
  const achados = definerSemSearchPath([
    sintetica(
      1,
      "create function public.a() returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;" +
        "create function public.b() returns void language plpgsql security definer as $$ begin end; $$;",
    ),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].nome, "public.b");
});

test("detector: set search_path dentro do corpo não vale — o corpo roda depois", () => {
  const achados = definerSemSearchPath([
    sintetica(
      1,
      "create function public.f() returns void language plpgsql security definer as $$ begin set search_path = 'public'; end; $$;",
    ),
  ]);
  assert.equal(achados.length, 1, "search_path no corpo é tarde: o atributo é que blinda a resolução");
});

test("detector: função citada em comentário não vira achado", () => {
  const achados = definerSemSearchPath([
    sintetica(1, "-- create function public.exemplo() security definer as $$ $$;\nselect 1;"),
  ]);
  assert.deepEqual(achados, []);
});

test("migrações reais: toda função SECURITY DEFINER fixa search_path", () => {
  const achados = definerSemSearchPath(lerMigracoes());
  assert.deepEqual(
    achados.map((v) => `${v.arquivo}:${v.linha} -> ${v.nome}`),
    [],
    "função SECURITY DEFINER sem `set search_path` deixa quem chama escolher em " +
      "que schema os nomes resolvem, executando código de terceiro com o " +
      "privilégio do dono da função. Acrescente set search_path = '' e qualifique " +
      "os nomes internos.",
  );
});
