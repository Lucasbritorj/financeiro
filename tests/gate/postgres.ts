// A versão de Postgres de cada lugar que executa as migrações deste projeto.
//
// CONTRATO
//   Garante  — que existe UM lugar declarando qual major roda em produção, qual
//              roda no CI, e — quando os dois diferem — que essa diferença foi
//              escrita por alguém, com motivo. É dado; quem compara é
//              tests/unit/gate-ci-postgres.test.ts.
//   Não faz  — não conecta em banco nenhum e não troca imagem de ninguém.
//   Vermelho — provado com ci.yml e run_local.sh sintéticos naquele arquivo.
//
// POR QUE ISTO EXISTE:
// os asserts SQL rodam `8/8` verdes contra postgres:16-alpine, e produção é
// 17.6. Verde numa versão que não é a de produção é uma afirmação mais fraca do
// que parece, e a diferença não é teórica neste schema: a migração 0022 revoga
// MAINTAIN dentro de dois blocos
//
//     do $do$ begin execute '...' exception when syntax_error or
//     feature_not_supported then raise notice '...' end $do$;
//
// e MAINTAIN só existe a partir do PG17. No CI de hoje esses dois ramos caem no
// EXCEPTION e viram notice — ou seja, o CI verde NÃO exercita o caminho que
// roda em produção, e nunca exercitou.
//
// Até 17/08/2026 esse fato morava em um comentário dentro de uma migração e em
// outro dentro da 0027. Comentário não é lido por ninguém no dia em que
// importa. Aqui ele é lido a cada `npm test`.

/** A versão que roda em produção. */
export const MAJOR_PRODUCAO = 17;

/** Onde a afirmação acima foi conferida. */
export const FONTE_PRODUCAO =
  "supabase/migrations/0027_rls_auto_enable_event_trigger.sql, comentário datado: " +
  "executado em 12/08/2026 contra o projeto Supabase bqkichuwmugkjumpvrio " +
  "(Postgres 17.6).";

/**
 * A divergência entre CI e produção que hoje é aceita, e por quê.
 *
 * `null` significa "não há divergência aceita" — e aí o gate exige que CI e
 * produção batam. Enquanto for um objeto, o gate exige que ele descreva
 * EXATAMENTE o par que está no disco: declaração que envelheceu é tão ruim
 * quanto divergência não declarada, porque as duas fazem o leitor confiar num
 * texto que não corresponde mais ao arquivo.
 */
export const DIVERGENCIA_DECLARADA: {
  readonly majorCi: number;
  readonly majorProducao: number;
  readonly motivo: string;
  readonly oQueExigeRemover: string;
} | null = {
  majorCi: 16,
  majorProducao: 17,
  motivo:
    "a troca para postgres:17-alpine não tem veredito local: subir Postgres real " +
    "exige container, e o único juiz honesto dela é o job `sql` do CI, que só " +
    "roda depois do push. Trocar a imagem junto com esta declaração seria " +
    "entregar uma mudança de risco médio sem nenhuma evidência — o modo de " +
    "falha que já custou um patch revertido neste repositório. A divergência " +
    "fica, declarada e datada (17/08/2026), até alguém rodar o job `sql` em 17.",
  oQueExigeRemover:
    "trocar `image: postgres:16-alpine` para 17 no ci.yml E `IMAGEM=` em " +
    "tests/sql/run_local.sh, ver o job `sql` verde num push de teste, e então " +
    "apagar esta declaração — o gate cobra que ela suma quando os majors baterem.",
};

/**
 * O major de uma referência de imagem Docker do Postgres.
 *
 * Aceita `postgres:16`, `postgres:16.4`, `postgres:16-alpine`. Devolve `null`
 * quando não sabe ler — o chamador transforma isso em queixa, porque um `null`
 * silencioso viraria gate verde por ilegibilidade.
 */
export function majorDaImagem(imagem: string): number | null {
  const casa = /^postgres:(\d+)(?:[.\d]+)?(?:-[\w.]+)?$/.exec(imagem.trim());

  return casa ? Number(casa[1]) : null;
}

/**
 * A imagem fixada em tests/sql/run_local.sh.
 *
 * O script é shell, não YAML: a linha é `IMAGEM=postgres:16-alpine`. Ele entra
 * no gate porque é o segundo lugar que roda as mesmas migrações — e dois
 * lugares com a mesma verdade divergem em silêncio, que é a lição que
 * tests/gate/etapas.ts já aprendeu para o job `node`.
 */
export function imagemDoRunLocal(script: string): string {
  const casa = /^\s*IMAGEM=(\S+)\s*$/m.exec(script);
  if (!casa) {
    throw new Error(
      "run_local.sh ilegível: não achei a linha `IMAGEM=...`. Se o script " +
        "deixou de fixar a imagem assim, este gate precisa saber — silêncio " +
        "aqui viraria cobertura imaginária.",
    );
  }

  return casa[1];
}
