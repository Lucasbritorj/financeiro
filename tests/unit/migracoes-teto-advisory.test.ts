import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMigracoes, limparSql, linhaDe, normalizarNome } from "./_migracoes.ts";

// Contrato (feature [2] do run financeiro-web-lote-invariantes): este arquivo é
// o ÚNICO alterado. Reaproveita lerMigracoes/limparSql/linhaDe/normalizarNome de
// `_migracoes.ts` por import, sem tocá-lo. Não altera src/, supabase/ nem config.
//
// O CLAUDE.md deste projeto manda, para RPC de escrita: "Teto anti-abuso com
// pg_advisory_xact_lock antes do count." Hoje isso é prosa, e prosa não quebra o
// CI.
//
// Por que o lock antes do count importa (corrida TOCTOU sob READ COMMITTED):
// um teto conta linhas EXISTENTES do usuário e compara com um limite. Duas
// chamadas concorrentes do MESMO usuário à MESMA RPC podem ler o MESMO count
// antes de qualquer uma commitar seu INSERT — ambas passam no teto (teto de 20
// vira 21, 22...). FOR UPDATE não resolve: não há linha do novo registro para
// travar. `pg_advisory_xact_lock(hashtext('<rpc>:<user_id>'))` serializa as
// chamadas antes da leitura do count; por ser _xact_, solta no fim da transação.
//
// Este gate é estático: resolve a versão FINAL de cada função public (a última
// `create or replace` em ordem de nome de arquivo; `drop function` remove) e,
// para cada função SECURITY DEFINER cuja versão final tem `count(`, exige que o
// advisory lock apareça ANTES do primeiro count no corpo.
//
// A classificação teto vs não-teto é julgamento do autor, gravado aqui:
//   - teto  = count comparado a um limite que levanta erro (tipicamente FW429);
//             exige lock antes do count.
//   - não-teto = count de relatório ou resumo; entra na ALLOWLIST com motivo.
// Fail-closed: count de função SECURITY DEFINER que não está na allowlist é
// tratado como teto e cobrado. Allowlist/PENDENTE-LUCAS que não casam com
// nenhuma função também falham (não podem ficar obsoletas).
//
// D10: lacuna real de lock NÃO vira migration. Vira ACHADO em PENDENTE_LUCAS,
// com arquivo:linha e a explicação da corrida, e o gate passa até o Lucas decidir.

// ---------------------------------------------------------------------------
// Entrada do detector: só precisa do nome do arquivo e do SQL bruto. O `sql`
// limpo (limparSql) é recomputado aqui para que casos sintéticos passem pelo
// mesmo caminho que as migrations reais.
interface Mig {
  arquivo: string;
  bruto: string;
}

interface Detalhe {
  nome: string; // normalizado (public.foo)
  arquivo: string;
  definer: boolean;
  temCount: boolean;
  offCount: number; // offset no arquivo do primeiro count(, ou -1
  linhaCount: number;
  lockAntes: boolean; // pg_advisory_xact_lock aparece antes do primeiro count
}

interface ItemAllow {
  funcao: string;
  motivo: string;
}

interface ItemPendente {
  funcao: string;
  arquivo: string;
  linha: number;
  explicacao: string;
}

interface Local {
  nome: string;
  arquivo: string;
  linha: number;
}

interface Classificacao {
  tetoComLock: Local[];
  naoTeto: { nome: string; arquivo: string }[];
  achados: Local[]; // teto sem lock coberto por PENDENTE_LUCAS
  violacoes: Local[]; // teto sem lock não coberto — falha o gate
  allowlistObsoleta: string[];
  pendenteObsoleta: string[];
}

// Delimitador dollar-quoted: `$$` (tag vazia) ou `$tag$` com tag que começa por
// letra/underscore. `$1$` (parâmetro posicional) não casa, de propósito.
const RE_DELIM = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Para a `create function` em `idxCreate` (offset no SQL limpo), devolve se é
 * SECURITY DEFINER e o corpo (miolo dollar-quoted) já passado por limparSql —
 * que apaga comentário, string e dollar aninhado, deixando o código visível.
 * `bodyStart` é o offset do início do corpo no arquivo (vale igual no bruto,
 * porque limparSql preserva o comprimento).
 */
function corpoDaFuncao(
  sqlLimpo: string,
  bruto: string,
  idxCreate: number,
): { definer: boolean; corpo: string; bodyStart: number } | null {
  const resto = sqlLimpo.slice(idxCreate);
  const mDelim = RE_DELIM.exec(resto);
  if (mDelim === null) return null;
  const delim = mDelim[0];
  const openPos = idxCreate + mDelim.index;
  const bodyStart = openPos + delim.length;
  const closePos = sqlLimpo.indexOf(delim, bodyStart);
  if (closePos === -1) return null;
  const header = sqlLimpo.slice(idxCreate, openPos);
  const definer = /\bsecurity\s+definer\b/i.test(header);
  const corpo = limparSql(bruto.slice(bodyStart, closePos));
  return { definer, corpo, bodyStart };
}

/**
 * Versão final de cada função public: a última `create` em ordem de arquivo e,
 * dentro do arquivo, de offset. `drop function` zera (marca ausente). Chave é o
 * nome normalizado — overload por assinatura não é distinguido, que é o que a
 * expressão "última create or replace em ordem de nome de arquivo" pede.
 */
function resolverFinais(migs: Mig[]): Map<string, Detalhe | null> {
  const mapa = new Map<string, Detalhe | null>();

  for (const mig of migs) {
    const sqlLimpo = limparSql(mig.bruto);

    const eventos: { off: number; tipo: "create" | "drop"; nome: string }[] = [];
    const reC = /\bcreate\s+(?:or\s+replace\s+)?function\s+([^\s(]+)/gi;
    const reD = /\bdrop\s+function\s+(?:if\s+exists\s+)?([^\s(;]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = reC.exec(sqlLimpo)) !== null) {
      eventos.push({ off: m.index, tipo: "create", nome: normalizarNome(m[1]) });
    }
    while ((m = reD.exec(sqlLimpo)) !== null) {
      eventos.push({ off: m.index, tipo: "drop", nome: normalizarNome(m[1]) });
    }
    eventos.sort((a, b) => a.off - b.off);

    for (const ev of eventos) {
      if (ev.tipo === "drop") {
        mapa.set(ev.nome, null);
        continue;
      }
      const corpo = corpoDaFuncao(sqlLimpo, mig.bruto, ev.off);
      if (corpo === null) {
        mapa.set(ev.nome, {
          nome: ev.nome,
          arquivo: mig.arquivo,
          definer: false,
          temCount: false,
          offCount: -1,
          linhaCount: 0,
          lockAntes: false,
        });
        continue;
      }
      const corpoLower = corpo.corpo.toLowerCase();
      const mCount = /\bcount\s*\(/.exec(corpoLower);
      const offCountRel = mCount ? mCount.index : -1;
      const offLockRel = corpoLower.indexOf("pg_advisory_xact_lock");
      const temCount = offCountRel >= 0;
      const offCountArq = corpo.bodyStart + offCountRel;
      mapa.set(ev.nome, {
        nome: ev.nome,
        arquivo: mig.arquivo,
        definer: corpo.definer,
        temCount,
        offCount: offCountArq,
        linhaCount: temCount ? linhaDe(mig.bruto, offCountArq) : 0,
        lockAntes: offLockRel >= 0 && temCount && offLockRel < offCountRel,
      });
    }
  }

  return mapa;
}

function classificar(
  migs: Mig[],
  allowlist: ItemAllow[],
  pendente: ItemPendente[],
): Classificacao {
  const finais = resolverFinais(migs);
  const comCount = [...finais.values()].filter(
    (d): d is Detalhe => d !== null && d.definer && d.temCount,
  );

  const tetoComLock: Local[] = [];
  const naoTeto: { nome: string; arquivo: string }[] = [];
  const achados: Local[] = [];
  const violacoes: Local[] = [];
  const nomesComCount = new Set<string>();
  const nomesTetoSemLock = new Set<string>();

  for (const f of comCount) {
    nomesComCount.add(f.nome);
    const naAllow = allowlist.some((a) => normalizarNome(a.funcao) === f.nome);
    if (naAllow) {
      naoTeto.push({ nome: f.nome, arquivo: f.arquivo });
      continue;
    }
    // Não está na allowlist => tratado como teto anti-abuso.
    if (f.lockAntes) {
      tetoComLock.push({ nome: f.nome, arquivo: f.arquivo, linha: f.linhaCount });
      continue;
    }
    // Teto sem lock antes do count.
    nomesTetoSemLock.add(f.nome);
    const naPendente = pendente.some((p) => normalizarNome(p.funcao) === f.nome);
    const local: Local = { nome: f.nome, arquivo: f.arquivo, linha: f.linhaCount };
    if (naPendente) achados.push(local);
    else violacoes.push(local);
  }

  const allowlistObsoleta = allowlist
    .filter((a) => !nomesComCount.has(normalizarNome(a.funcao)))
    .map((a) => a.funcao);
  const pendenteObsoleta = pendente
    .filter((p) => !nomesTetoSemLock.has(normalizarNome(p.funcao)))
    .map((p) => p.funcao);

  const porNome = (a: { nome: string }, b: { nome: string }) =>
    a.nome.localeCompare(b.nome);
  tetoComLock.sort(porNome);
  naoTeto.sort(porNome);
  achados.sort(porNome);
  violacoes.sort(porNome);

  return { tetoComLock, naoTeto, achados, violacoes, allowlistObsoleta, pendenteObsoleta };
}

// ---------------------------------------------------------------------------
// Classificação do autor sobre as migrations REAIS deste projeto.
//
// Não-teto (count que não é teto anti-abuso):
const ALLOWLIST_NAO_TETO: ItemAllow[] = [
  {
    funcao: "public.criar_importacao",
    motivo:
      "count(*) filter só resume a classificação (NOVO/DUPLICADO/AMBIGUO/LIQUIDACAO) no retorno; o teto de lote usa jsonb_array_length(p_linhas), estado da própria chamada, não count de linhas compartilhadas — sem corrida entre chamadas.",
  },
  {
    funcao: "public.excluir_transacao",
    motivo:
      "count(*) into v_afetadas é relatório (parcelas_afetadas no retorno), não é comparado a limite nem levanta FW429 — não é teto anti-abuso.",
  },
];

// Teto anti-abuso sem lock antes do count numa RPC REAL (D10: não vira migration,
// vira ACHADO). Vazio: as quatro RPCs com teto (criar_cartao, criar_categoria,
// criar_regra_categorizacao, criar_cofrinho) têm a versão final na 0019, todas
// com pg_advisory_xact_lock antes do count.
const PENDENTE_LUCAS: ItemPendente[] = [];

function migsReais(): Mig[] {
  return lerMigracoes().map((m) => ({ arquivo: m.arquivo, bruto: m.bruto }));
}

// ---------------------------------------------------------------------------
// Casos sintéticos — provam que o detector acende no vermelho e não no verde.

function sqlTeto(nome: string, lock: "antes" | "depois" | "nenhum"): string {
  const linhaLock = "  perform pg_advisory_xact_lock(hashtext('cap:' || auth.uid()::text));";
  const linhaCount = "  select count(*) into v_qtd from public.t where user_id = auth.uid();";
  const corpo =
    lock === "antes"
      ? [linhaLock, linhaCount]
      : lock === "depois"
        ? [linhaCount, linhaLock]
        : [linhaCount];
  return [
    `create or replace function ${nome}(p int)`,
    `returns void language plpgsql security definer set search_path = '' as $$`,
    `declare v_qtd int;`,
    `begin`,
    ...corpo,
    `  if v_qtd >= 5 then`,
    `    raise exception 'teto' using errcode = 'FW429';`,
    `  end if;`,
    `end;`,
    `$$;`,
  ].join("\n");
}

function mig(arquivo: string, bruto: string): Mig {
  return { arquivo, bruto };
}

test("detector VERMELHO: teto sem lock é violação", () => {
  const r = classificar([mig("9001_synth.sql", sqlTeto("public.synth_cap", "nenhum"))], [], []);
  assert.equal(r.violacoes.length, 1, "count de teto sem advisory lock precisa acender");
  assert.equal(r.violacoes[0].nome, "public.synth_cap");
  assert.equal(r.tetoComLock.length, 0);
});

test("detector VERMELHO: lock depois do count é violação", () => {
  const r = classificar([mig("9001_synth.sql", sqlTeto("public.synth_cap", "depois"))], [], []);
  assert.equal(r.violacoes.length, 1, "lock que vem depois do count não serializa a leitura do teto");
  assert.equal(r.violacoes[0].nome, "public.synth_cap");
  assert.equal(r.tetoComLock.length, 0);
});

test("detector VERDE: lock antes do count passa", () => {
  const r = classificar([mig("9001_synth.sql", sqlTeto("public.synth_cap", "antes"))], [], []);
  assert.deepEqual(r.violacoes, []);
  assert.equal(r.tetoComLock.length, 1);
  assert.equal(r.tetoComLock[0].nome, "public.synth_cap");
});

test("detector VERDE: versão antiga sem lock, versão final com lock", () => {
  const r = classificar(
    [
      mig("9001_synth.sql", sqlTeto("public.synth_cap", "nenhum")),
      mig("9002_synth.sql", sqlTeto("public.synth_cap", "antes")),
    ],
    [],
    [],
  );
  assert.deepEqual(r.violacoes, [], "só a versão final conta, e a final (9002) tem lock");
  assert.equal(r.tetoComLock.length, 1);
  assert.equal(r.tetoComLock[0].arquivo, "9002_synth.sql");
});

test("detector: count não-teto exige allowlist (fail-closed)", () => {
  const sql = [
    `create or replace function public.synth_rel(p uuid)`,
    `returns int language plpgsql security definer set search_path = '' as $$`,
    `declare v int;`,
    `begin`,
    `  select count(*) into v from public.parcelas where transacao_id = p;`,
    `  return v;`,
    `end;`,
    `$$;`,
  ].join("\n");
  const semAllow = classificar([mig("9003_synth.sql", sql)], [], []);
  assert.equal(semAllow.violacoes.length, 1, "count sem allowlist é tratado como teto");
  const comAllow = classificar([mig("9003_synth.sql", sql)], [{ funcao: "public.synth_rel", motivo: "relatório" }], []);
  assert.deepEqual(comAllow.violacoes, []);
  assert.equal(comAllow.naoTeto.length, 1);
});

test("detector: função sem SECURITY DEFINER não é cobrada", () => {
  const sql = [
    `create or replace function public.synth_sql(p uuid)`,
    `returns int language sql stable set search_path = '' as $$`,
    `  select count(*)::int from public.t where id = p;`,
    `$$;`,
  ].join("\n");
  const r = classificar([mig("9004_synth.sql", sql)], [], []);
  assert.deepEqual(r.violacoes, []);
  assert.equal(r.tetoComLock.length, 0);
  assert.equal(r.naoTeto.length, 0);
});

test("detector: count citado só em comentário do corpo não é teto", () => {
  const sql = [
    `create or replace function public.synth_cmt()`,
    `returns void language plpgsql security definer set search_path = '' as $$`,
    `begin`,
    `  -- select count(*) aqui seria teto, mas é comentário`,
    `  perform 1;`,
    `end;`,
    `$$;`,
  ].join("\n");
  const r = classificar([mig("9005_synth.sql", sql)], [], []);
  assert.deepEqual(r.violacoes, []);
  assert.equal(r.tetoComLock.length, 0);
});

test("detector: drop function remove a versão final", () => {
  const r = classificar(
    [
      mig("9001_synth.sql", sqlTeto("public.synth_cap", "nenhum")),
      mig("9002_synth.sql", "drop function if exists public.synth_cap(int);"),
    ],
    [],
    [],
  );
  assert.deepEqual(r.violacoes, [], "após o drop não há versão final para cobrar");
});

test("detector: allowlist que não casa com função falha (não fica obsoleta)", () => {
  const r = classificar(
    [mig("9001_synth.sql", sqlTeto("public.synth_cap", "antes"))],
    [{ funcao: "public.inexistente", motivo: "x" }],
    [],
  );
  assert.deepEqual(r.allowlistObsoleta, ["public.inexistente"]);
});

test("detector: PENDENTE-LUCAS cobre teto sem lock e não pode ficar obsoleta", () => {
  const cobre = classificar(
    [mig("9001_synth.sql", sqlTeto("public.synth_cap", "nenhum"))],
    [],
    [{ funcao: "public.synth_cap", arquivo: "9001_synth.sql", linha: 5, explicacao: "corrida" }],
  );
  assert.deepEqual(cobre.violacoes, [], "PENDENTE-LUCAS deixa o gate passar");
  assert.equal(cobre.achados.length, 1);
  assert.deepEqual(cobre.pendenteObsoleta, []);

  const obsoleta = classificar(
    [mig("9002_synth.sql", sqlTeto("public.synth_cap", "antes"))],
    [],
    [{ funcao: "public.synth_cap", arquivo: "x", linha: 1, explicacao: "y" }],
  );
  assert.deepEqual(obsoleta.pendenteObsoleta, ["public.synth_cap"], "a função ganhou lock; a pendência virou obsoleta");
});

test("regressão: remover o advisory lock de uma RPC real vira violação", () => {
  // Redefine criar_cartao numa migração POSTERIOR sem o lock: a resolução de
  // versão final passa a apontar para a versão sem trava e o gate deve acender.
  const migs = migsReais();
  migs.push(mig("9999_regressao.sql", sqlTeto("public.criar_cartao", "nenhum")));
  const r = classificar(migs, ALLOWLIST_NAO_TETO, PENDENTE_LUCAS);
  assert.ok(
    r.violacoes.some((v) => v.nome === "public.criar_cartao"),
    "se a versão final de criar_cartao perder o lock, o teto fica sem trava e o gate deve falhar",
  );
});

// ---------------------------------------------------------------------------
// O gate real. Imprime o que leu — "li tudo" tem que ser distinguível de "li
// nada" (um gate que nasce verde sobre código já correto trava a contagem).

test("migrações reais: todo teto anti-abuso tem advisory lock antes do count", () => {
  const r = classificar(migsReais(), ALLOWLIST_NAO_TETO, PENDENTE_LUCAS);

  console.log("teto com lock:", r.tetoComLock.map((t) => `${t.arquivo}:${t.linha} ${t.nome}`));
  console.log("não-teto (allowlist):", r.naoTeto.map((n) => `${n.arquivo} ${n.nome}`));
  console.log("ACHADOS (PENDENTE-LUCAS):", r.achados.map((a) => `${a.arquivo}:${a.linha} ${a.nome}`));

  assert.deepEqual(
    r.violacoes.map((v) => `${v.arquivo}:${v.linha} -> ${v.nome}`),
    [],
    "teto anti-abuso sem pg_advisory_xact_lock antes do count: duas chamadas " +
      "concorrentes do mesmo usuário leem o mesmo count e ambas passam do teto. " +
      "D10 veta migration — registre a função em PENDENTE_LUCAS com a corrida.",
  );
  assert.deepEqual(r.achados, [], "sem ACHADO: nenhuma RPC real tem teto sem lock");
  assert.deepEqual(r.allowlistObsoleta, [], "allowlist não pode citar função que não existe mais com count");
  assert.deepEqual(r.pendenteObsoleta, [], "PENDENTE_LUCAS não pode citar função que já tem lock");

  // Prova que o gate LEU e classificou as funções reais, não que não achou nada.
  assert.deepEqual(
    new Set(r.tetoComLock.map((t) => t.nome)),
    new Set([
      "public.criar_cartao",
      "public.criar_categoria",
      "public.criar_regra_categorizacao",
      "public.criar_cofrinho",
    ]),
    "as quatro RPCs com teto anti-abuso (versão final na 0019) com lock antes do count",
  );
  assert.equal(r.tetoComLock.length, 4);
  assert.deepEqual(
    new Set(r.naoTeto.map((n) => n.nome)),
    new Set(["public.criar_importacao", "public.excluir_transacao"]),
    "os dois counts não-teto da allowlist casam com funções reais",
  );
  assert.equal(r.naoTeto.length, 2);
});
