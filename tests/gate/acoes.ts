// O runtime exigido de cada ação usada no .github/workflows/ci.yml.
//
// CONTRATO
//   Garante  — que existe UMA lista dizendo, por ação, a partir de qual major
//              ela roda em Node 24. É dado, não comportamento: quem compara
//              esta lista com o ci.yml é tests/unit/gate-ci-acoes.test.ts.
//   Não faz  — não consulta a rede. Um gate que pergunta ao GitHub qual é a
//              versão da vez fica vermelho por indisponibilidade e verde por
//              cache, e nenhum dos dois é o que ele deveria medir.
//   Vermelho — provado com ci.yml sintético naquele arquivo.
//
// POR QUE MAJOR MÍNIMO, E NÃO A VERSÃO DA VEZ:
// o que quebra o CI não é estar atrás da última release — é a ação declarar
// `using: node20` no action.yml dela. O GitHub deprecou o Node 20 nos runners e
// hoje FORÇA essas ações para Node 24; no dia em que parar de forçar, o CI cai
// sozinho, sem ninguém ter feito commit. Um gate que fixasse "v6" ficaria
// vermelho no dia do v7 — barulho por moda, não por risco. Fixando o major
// MÍNIMO, v6 e v7 passam e v4 não: o gate cobra a propriedade, não a novidade.
//
// COMO ATUALIZAR: ao acrescentar uma ação ao ci.yml, acrescente-a aqui com o
// major em que ela passou a `using: node24` — o campo `fonte` é onde essa
// afirmação fica auditável. Ação ausente desta lista é queixa de propósito:
// silêncio viraria cobertura imaginária.

export interface AcaoConhecida {
  /** O menor major cujo `action.yml` declara `using: node24`. */
  readonly majorMinimo: number;
  /** Onde essa afirmação foi conferida. Não é enfeite: é o que a torna auditável. */
  readonly fonte: string;
}

export const ACOES_CONHECIDAS: Readonly<Record<string, AcaoConhecida>> = {
  "actions/checkout": {
    majorMinimo: 5,
    fonte:
      "action.yml da tag v5 declara `using: node24` (release v5.0.0, 11/08/2025, " +
      '"Update actions checkout to use node 24"). v4 declara node20. Conferido ' +
      "em 17/08/2026 pelo action.yml das tags v4, v5, v6 e v7.",
  },
  "actions/setup-node": {
    majorMinimo: 5,
    fonte:
      "action.yml da tag v5 declara `using: node24` (release v5.0.0, 04/09/2025, " +
      '"Upgrade action to use node24"). v4 declara node20. Conferido em ' +
      "17/08/2026 pelo action.yml das tags v4, v5, v6 e v7.",
  },
  "actions/upload-artifact": {
    majorMinimo: 6,
    fonte:
      "action.yml das tags v4 e v5 declara `using: node20`; a v6 declara " +
      "`using: node24` (release v6.0.0, 12/12/2025). Conferido em 10/09/2026 " +
      "por `gh api repos/actions/upload-artifact/contents/action.yml?ref=<tag>` " +
      "nas tags v4, v5 e v6 — o v5 NÃO basta aqui, ao contrário de checkout e " +
      "setup-node, cujo salto para node24 foi no v5.",
  },
};

/**
 * O que este gate NÃO cobre, para o relatório não prometer demais.
 *
 * A versão do runner. `using: node24` exige runner >= v2.327.1, e quem decide
 * isso é o GitHub, não o repositório. Nos runners hospedados (`ubuntu-latest`)
 * é dado; num self-hosted desatualizado, uma ação verde neste gate falharia no
 * runner. Este repositório só usa `ubuntu-latest`, e o dia em que usar outro é
 * o dia de reler esta linha.
 */
export const FORA_DO_GATE_DE_ACOES: readonly string[] = [
  "a versão do runner que executa as ações (exigência de >= v2.327.1 para node24)",
  "mudanças de comportamento entre majors que não sejam o runtime — este gate " +
    "lê a versão, não o changelog",
];
