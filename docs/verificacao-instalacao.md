# Conferência da instalação do Ateliê

Este procedimento não aplica migrações nem altera configuração remota. Em 16/10/2026, a implementação foi conferida somente em serviços locais. O estado da produção continua sem confirmação.

## Banco: consultas somente de leitura

No SQL Editor do projeto correto, conferir versão e histórico:

```sql
select current_database(), current_setting('server_version');
select version, name from supabase_migrations.schema_migrations order by version;
```

Comparar com os arquivos de `supabase/migrations/`, inclusive `20261016200000_editar_cadastros.sql`. Se o histórico não existir ou as migrações antigas tiverem sido aplicadas manualmente, conferir os objetos; não reaplicar tudo por suposição:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos,
       p.prosecdef as security_definer, p.proconfig as configuracao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('editar_cartao','editar_cofrinho','editar_recorrencia',
    'editar_categoria','confirmar_importacao','processar_pagamento_fatura')
order by p.proname;

select tablename, rowsecurity from pg_tables
where schemaname='public' order by tablename;

select jobname, schedule, active from cron.job order by jobname;
```

As três novas edições devem existir com `security_definer=true` e `search_path` vazio. A conferência de texto não substitui testes de isolamento e execução. Um histórico ausente não prova que o objeto não foi instalado.

## Autenticação e recuperação

- Conferir em Authentication: confirmação de e-mail ligada e senha mínima de 8 caracteres.
- Conferir Site URL com a origem real do aplicativo e cadastrar a URL exata `https://SEU-DOMINIO/login/confirmar` em Redirect URLs. Substituir SEU-DOMINIO pelo domínio efetivo.
- O fluxo usa PKCE: o link deve ser aberto no mesmo navegador que solicitou a recuperação. O template padrão deve manter o link de confirmação gerado pelo Supabase (`ConfirmationURL`), respeitando o redirect solicitado.
- Conferir SMTP e limites de envio. Testar somente com uma conta de teste autorizada. Não copiar senhas, links ou tokens para relatórios.
- O arquivo `supabase/config.toml` é configuração versionada local; sua existência não comprova configuração remota.

Referência do fluxo: [documentação oficial Supabase](https://supabase.com/docs/guides/auth/passwords).

## Backups e publicação

- Conferir no painel o último backup bem-sucedido e a política de retenção; registrar data e ambiente sem baixar dados pessoais para o repositório.
- Conferir se a versão publicada corresponde ao código entregue e se a nova migração foi aplicada antes de disponibilizar os botões de edição.
- Publicação, aplicação de migrações e mudanças de configuração são uma etapa separada. Nenhuma foi executada remotamente nesta entrega.

## Reproduzir os testes locais

Usar a raiz deste projeto, Docker e o Supabase CLI já instalado:

```powershell
supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
supabase migration up --local
npm run test:e2e:local
```

O comando de navegador exige API em `http://127.0.0.1:54321`, cria contas temporárias, executa build e testa desktop e celular na porta 3100. Usa autenticação, API e Postgres reais; e-mails ficam no Mailpit local. Cada conta é removida ao final. Interrupção forçada pode deixar uma conta de teste, que deve ser removida apenas nessa instância local.

As jornadas locais são opcionais no runner de navegador público do CI. Rodar `npm run test:e2e` sem o ambiente local não valida jornadas autenticadas; elas aparecem como ignoradas. Não confundir esse resultado com prova de persistência.

O teste de volume gera 1.203 transações pelas RPCs sob o papel `authenticated` no container local `supabase_db_financeiro-web`; telas e exportação consultam a API real com teto de mil linhas.
