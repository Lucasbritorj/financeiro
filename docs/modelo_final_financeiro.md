# Modelo Final — Evolução do `financeiro-web`

> Documento único para importar no Claude Code (Fable). Consolida a análise estrutural, o segundo plano ("Sovereign Glass 2.0" + categorias + IA + Pluggy) e resolve as divergências. Priorizado para **budget limitado (~10% de Fable)**: os blocos estão em ordem de impacto e cada um é entregável sozinho — dá pra parar entre blocos sem deixar nada quebrado.
>
> Companion visual: `mockup_dashboard.html` (o alvo de design). Este .md é a fonte da verdade de escopo.

---

## 0. Diagnóstico (uma frase)

O back-end é de fintech e sólido (centavos `bigint`, RLS, RPCs `SECURITY DEFINER`, protocolo `FW4xx`, soft delete). Falta a **camada de assistente** — categorias, insights, planejamento — e o visual convergiu para o padrão genérico. O trabalho abaixo não refaz o back-end; investe onde está o valor e corrige o rumo visual.

---

## 1. Decisões críticas — o que consolidar e o que descartar

Comparando os dois materiais, estas são as chamadas. Tabela é o coração deste documento.

| Proposto | Decisão | Por quê |
|---|---|---|
| **"Sovereign Glass 2.0"**: `blur(20px)`, glow radial mais intenso, mais camadas de vidro | **Rejeitar a intensificação.** Mantenha o nome se gostar; inverta a direção | Mais vidro e mais glow amplificam exatamente o que faz o app parecer genérico/IA-default. Impacto premium vem de hierarquia, tipografia, dados bem visualizados e **uma** assinatura — não de mais blur. Vidro pesado ainda custa contraste/acessibilidade |
| Categorização **por IA (Grok/xAI) a cada transação** | **Regras primeiro; IA só na cauda não-resolvida.** Vendor é sua escolha | LLM por transação é caro, lento e envia a descrição financeira a um terceiro. Regras (regex de comerciante: `IFOOD`, `UBER`, `99*`, `AMAZON`) resolvem 80%+ de graça, na hora e localmente. Você já tem a **API da Anthropic** conectada neste ambiente; se for usar LLM, é a opção natural — mas Grok também serve. O ponto forte é arquitetural, não de marca |
| Ícones **emoji** (🍔🚕🏠) nas categorias | Set de ícones consistente (lucide); emoji só como default rápido | Emoji renderiza diferente por SO e destoa de um visual premium |
| Cor padrão de categoria `#4cc9a6` | Usar tokens da paleta nova (§2) | É o verde genérico do problema visual original |
| Migration `0007` **simples** (sem hierarquia/regras) | Fundir com a versão completa: hierarquia opcional + **tabela de regras** | A tabela de regras é o que torna a categorização barata e "que aprende" sem ML |
| Importação **só CSV** | **CSV agora + Pluggy (Open Finance) como Nível 2** | Pluggy conecta os bancos BR por uma API única, já entrega transações **categorizadas**, é regulado pelo BCB e a responsabilidade regulatória fica com eles. Bem melhor que só OFX/CSV a médio prazo |
| Exportação PDF/CSV · onboarding guiado | **Incorporar** | Boas adições ausentes na minha v1; escopo modesto, alto valor de UX |
| Máquina de fatura (ciclo `ABERTA/FECHADA/PAGA` + `pg_cron` + pagamento) | **Congelar** (não apagar) | Peso de banco para um controle pessoal. Manter parado; rebaixar fatura a uma view derivada |
| Arredondamento defendido com validação/cerimônia | **Regra de uma linha:** resto na 1ª parcela; manter centavos-inteiro | Centavos-inteiro é a solução barata (mantém). O desperdício era a cerimônia em volta — rejeitar > 2 casas etc. |
| Realtime aprimorado · multi-moeda/i18n | **Backlog** | App pessoal + BRL; não superinvestir agora |

---

## 2. Direção visual — "Ateliê" (substitui o Sovereign Glass)

Alvo navegável: `mockup_dashboard.html`. Princípio: **gastar a ousadia em um lugar só e manter o resto quieto.**

**Paleta (6 tokens, quente, superfícies sólidas — sem glass):**

| Token | Hex | Uso |
|---|---|---|
| `tinta` | `#161311` | Fundo (espresso quente, não preto azulado) |
| `pergaminho` | `#1E1A17` | Superfície de card |
| `giz` | `#F1EBE0` | Texto primário |
| `grafite` | `#A69C8D` | Texto secundário |
| `ouro` | `#D9A24E` | **Assinatura** — cofrinhos, destaques, CTA. Com parcimônia |
| `verde` / `telha` | `#7CB49A` / `#D6674E` | Entrada/positivo · saída/negativo |

Ofereça também um **tema claro** quente (fundo `#F7F3EC`, evitando o creme-clichê `#F4F1EA`) como padrão opcional.

**Tipografia (3 papéis, abandonar o Geist genérico):** **Fraunces** (serifa com caráter — herói e títulos, com restrição) · **Hanken Grotesk** (corpo/UI) · **IBM Plex Mono** com `tabular-nums` (números — mantém o princípio já correto de numerais que não "pulam").

**Elemento-assinatura — o herói narrativo.** Em vez do número gigante genérico, o topo abre com uma **frase** que resume o mês, com os valores embutidos em ouro/mono:

> *"Você já gastou **R$ 3.240** em julho — **12% abaixo** de junho. **Delivery** passou do limite; **Mercado** está dentro do plano."*

A frase é montada por **regras determinísticas** (§4-B), não por LLM — instantânea e sem custo. É o assistente tornado visual.

**Estrutura que vem do 2º plano e vale manter:** sidebar fixa, top bar com saldo, gráfico de pizza (donut) por categoria, top despesas, próximas contas, cards de meta. Melhor hierarquia, espaçamento e contraste. **Micro-interações discretas** (não o odômetro/ruído/glow-no-cursor atuais).

**Piso de qualidade (não-negociável):** responsivo até mobile, foco de teclado visível, `prefers-reduced-motion` respeitado, contraste AA. Copy em voz ativa ("Salvar", não "Submeter"; o botão "Pagar" gera toast "Pago"). Estados vazios como convite à ação, não placeholder morto.

---

## 3. Ordem de execução (por impacto / budget)

Segue sua priorização, refinada. Faça em ordem; pare entre blocos se o Fable acabar. **Se o budget apertar no meio, corte de baixo pra cima.**

- **Bloco A — Fundação e higiene** (barato, primeiro). Corrigir middleware, edição de transação, paginação, simplificar dinheiro, congelar faturas.
- **Bloco B — Categorias + insights + redesign** (maior impacto). O app passa a *parecer* e *agir* como assistente. Insights saem de graça das categorias.
- **Bloco C — Importação em camadas** (fricção zero). Nível 1: CSV + dedupe + categorização por regras/IA-fallback, agora. Nível 2: Pluggy, como esforço separado depois de validar o MVP.
- **Bloco D — Planejamento leve** (se sobrar budget). Cofrinhos por horizonte + orçamento por envelope.
- **Fase seguinte** (quando houver budget). Assistente conversacional, panorama econômico (BCB), export PDF/CSV, recorrências.

> Nota de honestidade: sua visão original girava em torno de **cofrinhos + assistente + notícias**. Com ~10% de Fable, o pragmático é priorizar visual + categorias + importação (que já entregam "onde gasto mais/menos" e "para onde vai o dinheiro"). Cofrinhos é o primeiro a puxar da Fase seguinte assim que os blocos acima fecharem.

---

## 4. Especificações por bloco

Convenções de **toda** tabela nova: centavos `bigint`; `deleted_at` soft delete; RLS `auth.uid() = user_id AND deleted_at IS NULL`; escrita só por RPC `SECURITY DEFINER` com `search_path = ''`; erros `FW4xx` com `hint`. Não afrouxar a segurança existente.

### Bloco A — Fundação e higiene

1. **Middleware.** O arquivo é `src/proxy.ts` exportando `proxy`, mas o Next.js só ativa middleware em `src/middleware.ts` exportando `middleware` + `config`. Verificar se há re-export; se não, o guard de rotas roda só no layout e o middleware está inativo. Corrigir e validar com rota protegida sem sessão. **Aceite:** acesso a rota protegida sem cookie redireciona no middleware.
2. **Edição.** RPC `editar_transacao` (descrição, valor, data, categoria, forma de pagamento). Hoje só cria/exclui — sofrível no uso diário. **Aceite:** editar valor de um lançamento recalcula parcelas.
3. **Paginação.** Cursor por keyset (`data_compra`, `id`) em transações e faturas, no lugar do `.limit(N)` fixo. **Aceite:** navegar além dos 20 mais recentes.
4. **Dinheiro (§1).** Manter centavos-inteiro. Remover rejeição de > 2 casas e a cerimônia. Distribuição de parcelas: `base = total DIV n`, `resto = total MOD n`, **1ª parcela = base + resto**, demais = base. Enxugar `money.ts`/testes ao essencial. **Aceite:** R$ 100,00 em 3× → `33,34 / 33,33 / 33,33`, sem tela de erro.
5. **Congelar faturas (§1).** Tirar do fluxo principal; rebaixar `cartoes`/`faturas` a telas secundárias. Não apagar o código.

### Bloco B — Categorias + insights + redesign

**Modelo (funde as duas versões):**

```sql
create table categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  cor text,                       -- token da paleta (não #4cc9a6)
  icone text,                     -- nome lucide (emoji só como fallback)
  tipo text not null default 'DESPESA' check (tipo in ('DESPESA','RECEITA')),
  categoria_pai uuid references categorias(id),   -- hierarquia opcional
  orcamento_mensal bigint,        -- centavos, nullable (Bloco D)
  deleted_at timestamptz
);

create table regras_categorizacao (   -- o "cache" que aprende, sem ML
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  padrao text not null,           -- substring/regex sobre a descrição
  categoria_id uuid not null references categorias(id),
  prioridade int not null default 100,
  deleted_at timestamptz
);

alter table transacoes_origem add column categoria_id uuid references categorias(id);
```

Seed de categorias-padrão na criação do usuário. CRUD completo + página `/categorias`. `CategoriaSelector` visual no form (grade de ícones), reaproveitando o componente do 2º plano — trocando emoji por lucide e a cor default por token.

**Categorização (rota resolvida):** ao lançar/importar, aplicar `regras_categorizacao` por prioridade (primeira que casar vence). Quando o usuário recategoriza manualmente, **oferecer criar regra** ("sempre classificar `IFOOD*` como Alimentação?"). Só o que não casar vai para IA (batch, opcional) — com o aviso de privacidade do §5.

**Insights (determinísticos, baratos — alimentam o redesign):** gasto por categoria (donut + ranking gasto/orçamento), top despesas, comparativo mês-a-mês por categoria, maior despesa do mês, projeção de fechamento, taxa de poupança, e as **frases do herói narrativo** por template. **Aceite:** dashboard mostra donut + top despesas + frase-herói + comparativo com o mês anterior, sem chamar LLM.

**Redesign:** aplicar §2 sobre o dashboard e o form, tendo `mockup_dashboard.html` como alvo.

### Bloco C — Importação em camadas

**Nível 1 — CSV (agora).** Presets por banco (Nubank, Itaú, BB, Inter…) + mapeamento de colunas (data/valor/descrição). Fluxo: upload → **staging** → tela de revisão (categoria já sugerida pelas regras) → confirmar → commit em lote via RPC. Nunca importar direto no razão.

```sql
create table importacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  origem text,                    -- 'CSV' | 'PLUGGY' | 'OFX'
  status text default 'REVISAO',  -- REVISAO | CONFIRMADA | DESCARTADA
  criado_em timestamptz default now(), deleted_at timestamptz
);
create table importacao_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references importacoes(id),
  user_id uuid not null references auth.users(id),
  data date, valor bigint, descricao text,
  categoria_sugerida uuid references categorias(id),
  duplicada boolean default false, ignorar boolean default false,
  deleted_at timestamptz
);
```

**Dedupe:** marcar `duplicada = true` quando já existe transação com mesma `data` + mesmo `valor` + descrição semelhante (distância de edição). Duplicadas vêm desmarcadas na revisão. **Aceite:** OFX/CSV de 40 linhas → 2 marcadas como duplicadas → confirmar cria 38 num único lote, idempotente em re-tentativa.

**Nível 2 — Pluggy (Open Finance), depois de validar o MVP.** Esforço separado. Conecta os principais bancos BR por uma API única, com Widget de conexão e SDK; regulado pelo BCB (responsabilidade regulatória fica com a Pluggy — o app não precisa de licença). Integração básica de leitura de extrato costuma levar poucos dias; há trial sem cartão.
- Modelo: conectar conta = criar um **Item** (via Widget); ler dados nos endpoints **Account** e **Transaction**; **Auto-sync** para atualização.
- Vantagem: transações **já vêm categorizadas** pela Pluggy → mapear categoria-Pluggy → suas categorias, reduzindo a dependência de IA.
- **Caveat de dedupe (importante):** o ID de transação da Pluggy pode mudar se o banco altera um campo (ex.: descrição). Não confiar em sync incremental por ID puro — reconciliar por (data + valor + descrição) ou reextrair a janela. Reusar o mesmo staging do Nível 1.
- LGPD + consentimento explícito (OAuth2/FAPI/mTLS); usuário revoga quando quiser. Alternativas existem (ex.: Belvo) — não amarrar a um só na camada de abstração.

### Bloco D — Planejamento leve (se sobrar budget)

**Cofrinhos (curto/médio/longo prazo):**

```sql
create table cofrinhos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  nome text not null, icone text, cor text,
  valor_alvo bigint not null, data_alvo date,
  horizonte text not null check (horizonte in ('CURTO','MEDIO','LONGO')),
  saldo_atual bigint not null default 0,
  arquivado boolean not null default false, deleted_at timestamptz
);
create table movimentacoes_cofrinho (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  cofrinho_id uuid not null references cofrinhos(id),
  valor bigint not null, tipo text check (tipo in ('APORTE','RESGATE')),
  data date default current_date, deleted_at timestamptz
);
```

RPCs `criar_cofrinho`, `aportar_cofrinho`, `resgatar_cofrinho` (bloqueia resgate > saldo → `FW409`; atualiza `saldo_atual` no mesmo `FOR UPDATE`). Projeção: ritmo necessário = `(alvo − saldo) / meses_até_data`; status **no ritmo / atrasado / adiantado**; data projetada. UI: cards com anel de progresso agrupados por horizonte (ver mockup). **Aceite:** meta "Viagem R$ 15.000 até dez/26", aportar R$ 500, ver anel + status + data projetada.

**Orçamento por envelope:** reusa `categorias.orcamento_mensal`. Barra `gasto/orçamento`; alerta âmbar em 80%, `telha` em 100%+. O `painel-anomalia` atual generaliza aqui ("categoria X estourou o envelope"). **Aceite:** orçamento R$ 350 em Delivery, gasto R$ 410 → barra estourada + alerta.

### Fase seguinte (quando houver budget)

Condensado, para não perder o escopo:
- **Assistente conversacional (LLM):** chat que recebe **só agregados** (totais por categoria, saldo, metas), nunca o razão bruto. Responde "onde cortar R$ 200", "resumo da semana". Ver cuidados no §5.
- **Panorama econômico:** API pública do BCB (SGS), grátis, sem chave: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/{N}?formato=json`. Códigos: Dólar `1`, IBOV `7`, Selic meta `432`, CDI `12`, IPCA 12m `13522` (confirmar no ambiente). Cachear 1×/dia. Faixa com Selic·IPCA·Dólar·IBOV + manchetes. Educação de investimento contextual e **com disclaimer**.
- **Export PDF/CSV** do relatório mensal. **Recorrências** (contas fixas/assinaturas) para previsão e avisos.

---

## 5. Cuidados

- **Privacidade no LLM.** Regras resolvem a maioria sem enviar nada. IA (categorização ou assistente) recebe só o mínimo/agregado, nunca o extrato completo. O usuário deve conseguir usar o app inteiro sem LLM se preferir. Vale para qualquer vendor (Anthropic, xAI…).
- **Conselho financeiro.** O app informa e educa; não substitui consultor licenciado. Toda "dica de investimento" leva aviso de que é educativa e geral, sem recomendação de ativo específico como aconselhamento profissional e sem promessa de rendimento.
- **Open Finance / Pluggy.** Consentimento explícito, LGPD, dados só com autorização, revogável. Manter camada de abstração para não ficar preso a um agregador.
- **Segurança existente — manter.** RLS, DML-revogado, RPCs `DEFINER`, `search_path = ''`. Toda tabela nova entra no mesmo regime. Importação em lote atômica e idempotente.

---

## 6. Prompt para o Claude Code (Fable)

> Cole na raiz de `financeiro-web`, junto deste arquivo.

```
Leia modelo_final_financeiro.md por completo — é a fonte da verdade. Estou com budget
de Fable limitado (~10%), então execute em BLOCOS na ordem da seção 3, pare ao fim de
cada bloco e me mostre o que mudou + como validar antes de seguir. Se o budget apertar,
corte de baixo pra cima (Bloco D e Fase seguinte são os primeiros a sair).

Não refaça o back-end existente (centavos bigint, RLS, RPCs SECURITY DEFINER, FW4xx,
soft delete) — reaproveite e mantenha as convenções.

Bloco A (fundação): corrija o middleware, adicione RPC editar_transacao, paginação por
cursor, simplifique o dinheiro (centavos-inteiro; regra = resto na 1ª parcela; sem
rejeição de decimais), e congele a máquina de faturas (não apague; tire do fluxo).

Bloco B (impacto): categorias + tabela de regras de categorização + insights
determinísticos (donut, top despesas, comparativo, frase-herói) + o redesign visual da
seção 2 — direção "Ateliê", herói narrativo como assinatura, Fraunces + Hanken Grotesk
+ IBM Plex Mono, superfícies sólidas, SEM intensificar glassmorphism, tema claro
opcional. Alvo visual: mockup_dashboard.html. Categorização = regras primeiro; LLM só
na cauda não-resolvida (batch), com o cuidado de privacidade da seção 5.

Bloco C (importação): Nível 1 = CSV com presets de banco + staging + revisão + dedupe
(data+valor+descrição) + commit em lote atômico. Nível 2 = Pluggy (Open Finance) como
esforço separado, reusando o mesmo staging; atenção ao caveat de ID mutável da seção 4-C.

Bloco D (se sobrar): cofrinhos por horizonte + orçamento por envelope, conforme 4-D.

Cada tabela nova: bigint centavos, deleted_at, RLS auth.uid()=user_id, escrita só por
RPC SECURITY DEFINER com search_path=''. Respeite os cuidados da seção 5 (privacidade,
disclaimer de investimento, LGPD/consentimento). Cada bloco tem critério de aceite —
implemente até passar. Comece pelo Bloco A.
```

---

### Resumo das mudanças vs. os materiais anteriores

| Antes (v1 + 2º plano) | Modelo final |
|---|---|
| Roadmap amplo em 4-8 fases | 4 blocos + fase seguinte, cortáveis por budget |
| Glass intensificado (2.0) **vs** Ateliê (v1) — em conflito | Ateliê confirmado; intensificação de vidro rejeitada com justificativa |
| IA (Grok) categoriza toda transação | Regras primeiro, IA só na cauda; privacidade explícita |
| Importação só CSV/OFX | CSV agora + Pluggy (Open Finance) como Nível 2, com caveats reais |
| Sem export, onboarding disperso | Export PDF/CSV e onboarding incorporados |
| Cofrinhos/assistente como núcleo | Realistas para o budget: priorizados após visual+categorias+importação |
