// O contrato entre o alvo local `npm run gate` e o job `node` do CI.
//
// CONTRATO
//   Garante  — que existe UMA lista, e só uma, dizendo o que o job `node` de
//              .github/workflows/ci.yml faz e o que o gate local faz a respeito
//              de cada etapa dele.
//   Não faz  — não executa nada (isso é tests/gate/run.ts) e não lê o ci.yml
//              (isso é tests/gate/_ci-yml.ts). É dado, não comportamento.
//   Espelha  — o job `node` inteiro, etapa por etapa e na mesma ordem. O job
//              `sql` fica de fora por inteiro e isso é declarado, não omitido.
//   Vermelho — provado em tests/unit/gate-node-ci.test.ts, que compara esta
//              lista com o ci.yml real do repositório.
//
// Por que uma lista em vez dos comandos soltos num script: um alvo local que
// repete os comandos do CI cria um segundo lugar para a verdade morar, e os
// dois divergem em silêncio — alguém acrescenta um passo no ci.yml e o gate
// local continua verde medindo o CI de ontem. Aqui o runner executa A PARTIR
// desta lista e o gate estático compara ESTA lista com o ci.yml. Divergir
// passa a ser um teste vermelho em vez de uma descoberta no push.

/** O que o gate local faz a respeito de uma etapa do job `node`. */
export type Local =
  /** Roda o mesmo comando que o CI roda. */
  | { readonly tipo: "externo"; readonly comando: readonly string[] }
  /** Roda uma verificação equivalente, escrita aqui dentro. Exige `motivo`. */
  | { readonly tipo: "interno"; readonly chave: "pin-npm" }
  /** Não roda nada. Exige `motivo`, e o resumo do runner imprime esse motivo. */
  | { readonly tipo: "nenhum" };

export interface Etapa {
  /**
   * A identidade da etapa dentro do job `node`: o `name:` do step quando ele
   * tem um, senão a primeira linha do `run:`. É a chave pela qual o gate
   * estático parea esta lista com o ci.yml — mudar o texto no ci.yml sem mudar
   * aqui é exatamente a divergência que o gate existe para pegar.
   */
  readonly ci: string;
  readonly local: Local;
  /** Obrigatório quando o local não é a execução literal do comando do CI. */
  readonly motivo?: string;
}

/**
 * As etapas `run` do job `node`, na ordem do ci.yml.
 *
 * `actions/checkout` e `actions/setup-node` não entram: são `uses`, não `run`,
 * e o equivalente local delas é ter o repositório em disco e o Node instalado.
 * O gate estático compara apenas os `run`, pelo mesmo motivo.
 */
export const ETAPAS: readonly Etapa[] = [
  {
    ci: "pin do npm declarado em packageManager",
    local: { tipo: "interno", chave: "pin-npm" },
    motivo:
      "o CI aplica o pin com `npm i -g npm@$NPM_PIN`, que reescreve o npm da " +
      "máquina inteira. Um gate local não tem esse direito: instalar software " +
      "global é efeito colateral, não verificação. O equivalente local é " +
      "conferir que o npm em uso já é o pinado, e falhar quando não é — o " +
      "mesmo risco que o pin existe para cobrir (npm 11.6.2 valida um lockfile " +
      "que o 11.17.0 reprova).",
  },
  {
    ci: "npm ci",
    local: { tipo: "nenhum" },
    motivo:
      "apaga node_modules e exige rede a cada execução, o que tornaria o gate " +
      "caro demais para rodar antes de cada commit — e um gate que ninguém roda " +
      "não guarda nada. O comando do CI continua não rodando aqui. O que mudou " +
      "é que a parte dele que mais custou a este repositório — a sincronia do " +
      "package.json com o package-lock.json, que derrubou o CI de 13/08/2026 " +
      "(run 31745734787) — passou a ser coberta pelo preflight ancorado nesta " +
      "etapa (ver ACOES_LOCAIS abaixo), com `npm ci --dry-run`: a mesma " +
      "validação de lock, sem escrever um byte em disco. A instalação de " +
      "verdade segue fora do alvo, e segue declarada em FORA_DO_ALVO.",
  },
  {
    ci: "npx tsc --noEmit",
    local: { tipo: "externo", comando: ["npx", "tsc", "--noEmit"] },
  },
  {
    ci: "npm run lint",
    local: { tipo: "externo", comando: ["npm", "run", "lint"] },
  },
  {
    ci: "npm test",
    local: { tipo: "externo", comando: ["npm", "test"] },
  },
  {
    ci: "npm run build",
    local: { tipo: "externo", comando: ["npm", "run", "build"] },
  },
];

// ------------------------------------------------- ações locais (local-only)

/**
 * Uma verificação que o gate local roda e que o job `node` NÃO tem.
 *
 * Por que não é uma `Etapa`: `ETAPAS` é uma bijeção com os `run:` do ci.yml —
 * tests/unit/gate-node-ci.test.ts cobra os dois sentidos, e entrada sem
 * contraparte no YAML é "classificação órfã", vermelha de propósito. Uma
 * verificação que só existe aqui não é uma etapa mal-pareada: é outra
 * categoria. Enfiá-la em `ETAPAS` deixaria duas saídas, e as duas ruins —
 * inventar um step gêmeo no ci.yml só para o pareamento fechar (fazendo o CI
 * pagar de novo, num step separado, o que ele já paga dentro do `npm ci`), ou
 * afrouxar o gate estático para tolerar órfã, que é justamente a divergência
 * silenciosa que ele existe para pegar.
 *
 * `reduzLacunaDe` é a âncora: nomeia a etapa do CI cuja lacuna esta ação
 * encolhe, e é o ponto da sequência onde o runner a executa. Não é enfeite —
 * âncora que não existe em `ETAPAS` é ação que nunca roda, e isso é teste
 * vermelho lá.
 */
export interface AcaoLocal {
  /** A identidade da ação no resumo do runner. Nunca igual ao `ci:` de uma etapa. */
  readonly nome: string;
  readonly comando: readonly string[];
  /** Por que ela existe localmente sem espelhar step do CI. Obrigatório. */
  readonly motivo: string;
  /** O `ci:` da etapa cuja lacuna ela reduz. Precisa existir em `ETAPAS`. */
  readonly reduzLacunaDe: string;
}

/**
 * As verificações que o gate local faz por conta própria.
 *
 * Rodam logo depois da etapa que ancoram — o preflight do lock roda depois do
 * pin do npm justamente porque a resposta depende dele: 11.6.2 e 11.17.0
 * discordam sobre o que é um package-lock.json válido, e validar o lock com o
 * npm errado responderia a pergunta errada com a mesma cara de verde.
 */
export const ACOES_LOCAIS: readonly AcaoLocal[] = [
  {
    nome: "preflight: package.json em sincronia com package-lock.json",
    comando: ["npm", "ci", "--dry-run"],
    reduzLacunaDe: "npm ci",
    motivo:
      "`--dry-run` resolve o lock e reprova a dessincronia sem escrever nada: " +
      "não apaga node_modules, não instala e não precisa de árvore montada — " +
      "medido em 24/08/2026 num clone SEM node_modules, exit 0 em 1s, e o " +
      "diretório continuou não existindo depois. É a metade barata do que o " +
      "`npm ci` do CI faz: a validação do lock, não a instalação. Existe " +
      "porque era a única etapa do job `node` sem nenhum equivalente local, e " +
      "a que de fato derrubou o CI — dessincronizar o lock é vermelho em 8s no " +
      "runner e era invisível aqui até o push.",
  },
];

/**
 * O bloco `env:` do job `node`.
 *
 * Não é decoração: `next build` chama createClient e não sobe sem estas duas.
 * O runner injeta os mesmos valores QUANDO ELES FALTAM no ambiente — quem já
 * carrega as variáveis do próprio ambiente continua buildando com o que tem, e
 * quem não carrega (um clone limpo, um runner de CI) recebe o mesmo placeholder
 * que o CI recebe. Sem isso o gate local ou quebra no build ou mede um ambiente
 * que o CI não tem.
 */
export const ENV_DO_JOB: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
};

/**
 * O que este alvo não cobre, para o resumo dizer em voz alta.
 *
 * Um alvo chamado "gate" que cobre metade do CI mente por omissão: quem roda
 * ele verde e faz push acredita ter passado pelo CI inteiro. Estas linhas são
 * impressas ao fim de toda execução, verde ou vermelha.
 */
export const FORA_DO_ALVO: readonly string[] = [
  "o job `sql` do ci.yml (migrações + asserts em Postgres real) — precisa de " +
    "container, e `npm run gate` não sobe banco. Localmente é `npm run test:sql`, " +
    "com Postgres já de pé.",
  "a INSTALAÇÃO do `npm ci`: baixar os pacotes numa node_modules limpa, com " +
    "rede, como o runner faz. A SINCRONIA de package.json com package-lock.json " +
    "saiu desta lista — passou a ser coberta pelo preflight em ACOES_LOCAIS. O " +
    "que continua fora é o resto: pacote publicado quebrado, script de install " +
    "que falha, tarball sumido do registry. `--dry-run` resolve a árvore e não " +
    "busca um byte de tarball, então nada disso aparece aqui.",
  "a EXECUÇÃO de `actions/checkout` e `actions/setup-node`, que são `uses` e " +
    "não têm equivalente local. O que passou a ser coberto é a VERSÃO delas: " +
    "tests/unit/gate-ci-acoes.test.ts reprova major cujo runtime é Node 20, em " +
    "qualquer job. Ler `@v6` no YAML não é rodar `@v6` — a diferença entre as " +
    "duas coisas é esta linha.",
];
