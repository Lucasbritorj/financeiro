# Segurança: entrega e operação

Verificação em 21/10/2026. Esta entrega foi desenvolvida na pasta central do projeto. O worktree antigo e suas alterações pendentes foram preservados.

## Controles implementados

- Sessão em cookies HttpOnly, Secure em produção e SameSite=Lax. O navegador usa `/api/auth` e `/api/dados`, sem receber access token ou refresh token no JSON nem persistir sessão no SDK do navegador.
- O servidor valida usuário, origem das escritas, método, caminho, schema e limite real do corpo antes de encaminhar a chamada. Dados financeiros continuam usando o JWT do titular e RLS; a chave administrativa não substitui essa autorização.
- Login, cadastro, recuperação, senha, saída, leitura de dados, exportação e Pluggy consomem cotas persistentes. Falha no contador recusa a chamada. A cota é gravada em transação separada, portanto não desaparece quando uma importação é revertida.
- Cinco RPCs de lote exigem assinatura HMAC do servidor vinculada ao usuário, à função e a uma janela de 30 segundos. A chave fica somente no ambiente privado do servidor e em tabela sem acesso de anon/authenticated. Conexões administrativas do banco conservam acesso para manutenção; isso não é uma permissão disponível ao cliente PostgREST.
- A sincronização Pluggy também assina sua RPC, depois da cota e da validação de titularidade. A conexão real do provedor não foi exercitada nesta rodada; transporte e vínculo foram testados com respostas sintéticas.
- Logout com falha não aparenta sucesso. Troca de senha exige revogação global e mostra falha parcial se ela falhar. O servidor consulta o serviço de autenticação antes de acessar dados. JWT já emitido pode continuar válido em APIs externas até expirar; o TTL remoto observado foi 3.600 segundos.
- Erros internos são substituídos por mensagens genéricas. Códigos de negócio FW4xx mantêm mensagens orientativas. Eventos têm enum fechado e não carregam payload financeiro, usuário, senha ou token.
- CSP com nonce e os limites de expansão XLSX já existentes foram mantidos.

## Instalação concluída em produção em 21/10/2026

As duas migrações abaixo estão instaladas. A configuração privada foi criada como Sensitive na Vercel, a chave foi configurada pela RPC exclusiva do servidor e o domínio principal foi promovido para o deployment `dpl_AtrKcYCZRjCnYsEeG9df93EbXeik` (código da aplicação em `3e9c57b`). A comparação das 24 tabelas públicas anteriores confirmou preservação dos dados; RLS e ausência de acesso do cliente à chave/cota foram conferidos.

A prévia real passou no navegador em 1440 e 320 pixels. A produção foi verificada por HTTP autenticado da CLI, preservando a proteção de acesso da Vercel: página e rotas autenticadas200, redirecionamento HTTP→HTTPS, headers com nonce, login/cookies protegidos, lote pela API200, CSRF403, RPC direta sem assinatura FW403 e cookie antigo recusado401 após logout. Contas sintéticas de verificação foram removidas. Não foi feita sincronização bancária real pelo Pluggy.

Migrações incrementais:

1. `20261021200000_limites_servidor.sql`: tabela e função privadas de cotas; compatível com o aplicativo anterior.
2. `20261021203000_limites_rpcs.sql`: configuração privada e assinatura obrigatória dos lotes.

Variáveis privadas necessárias: `SUPABASE_SERVICE_ROLE_KEY` e `FINANCEIRO_RPC_SIGNING_KEY` (32 bytes aleatórios representados por 64 caracteres hexadecimais). Nunca usar prefixo `NEXT_PUBLIC_`, gravar valores em documentação ou enviá-los pelo chat. As variáveis públicas Supabase continuam sendo apenas URL e chave pública.

A instalação seguiu a sequência: nova cópia restaurada (58 tabelas), primeira migração, prévia validada, promoção da API/cliente e segunda migração com configuração privada pela RPC `configurar_chave_rpc_servidor`. Para futuras intervenções, fazer nova cópia e preparar os segredos no gerenciador privado antes da janela. Instalar a segunda migração isoladamente bloqueia clientes antigos e chamadas sem assinatura; não executar sem coordenar a publicação. Atualizar abas antigas após a mudança.

Para voltar à versão anterior, coordenar a restauração das definições anteriores das cinco funções com a promoção do deployment anterior. Não apagar lançamentos nem restaurar um dump antigo sobre dados novos como procedimento padrão de rollback. Produção e prévia receberam configuração privada separada na hospedagem, apontando ao mesmo banco desta aplicação pessoal; a chave precisa coincidir com a configuração desse banco. As provas remotas usaram exclusivamente contas sintéticas isoladas e removidas ao final. Os testes completos do CI continuam usando Supabase local descartável, sem credenciais nem dados de produção.

## Backup instalado e comprovado

`backup-financeiro.mjs` usa pacote compactado autenticado AES-256-GCM, chave de dados aleatória e chave RSA protegida pelo Windows DPAPI. A verificação restaura o conteúdo em Postgres17 descartável sem rede. Arquivos SQL temporários são removidos após sucesso ou erro; o marcador VERIFICADO só aparece depois da restauração e da conferência criptográfica.

A tarefa Windows `Financeiro-Backup-Verificado` foi instalada para 03h e início de sessão, sem sobreposição. Uma execução real terminou com resultado 0. Cópia real criptografada e nova leitura/restauração do mesmo arquivo conferiram 58 tabelas. Cópias e estado ficam somente em `C:\Backup\financeiro-web`, fora do repositório.

Limites: a tarefa depende deste computador ligado, do usuário conectado, Docker e credenciais locais disponíveis. DPAPI liga a chave privada ao usuário/máquina; perda do computador ainda exige estratégia independente de recuperação dessa chave. Não é recuperação de desastre completa. O envio privado à Hostinger não foi configurado: a consulta de sites pelo conector expirou. Não há prova de cópia fora desta máquina.

## Pendências operacionais observadas

| Item | Evidência atual | Próximo passo |
|---|---|---|
| Backups gerenciados Supabase | API de backups retornou zero cópias e PITR desativado | Conferir Database → Backups e plano; manter rotina local e configurar cópia externa privada com restauração independente |
| TLS obrigatório no Postgres direto | Ativado: CLI ssl-enforcement database=true, appliedSuccessfully=true | Conferência posterior confirmou a aplicação; HTTPS/API também verificados após a mudança |
| Auth | JWT 3.600s; senha mínima8; confirmação de e-mail ativa; CAPTCHA desativado; sem tempo máximo/inatividade de sessão | Rever política no painel Authentication → Settings/Security; confirmar compatibilidade do fluxo antes de mudar; proteger também Auth público com limites do provedor |
| Alertas | Eventos estruturados locais/servidor implementados; canal externo não definido | Definir canal privado e testar entrega/falha sem anexar dados financeiros ou credenciais |
| Cópia externa e chave de recuperação | Hostinger sem acesso validado nesta execução; chave DPAPI local | Validar conexão Hostinger e destino privado; guardar recuperação da chave em cofre independente |
| Publicação | Duas migrações instaladas, configuração privada conferida e domínio principal promovido | Verificações remotas acima aprovadas; atualizar abas antigas; GitHub na branch do PR17, sem merge em master |

## Dependências e verificação

`npm audit --omit=dev` não apontou vulnerabilidade em dependências de produção. A consulta completa ainda aponta três pacotes transitivos de desenvolvimento sem versão corrigida disponível no registro consultado: braces (alta), extract-zip (alta) e sprintf-js (moderada). Não há alegação de zero vulnerabilidades em toda a árvore. Manter ferramentas de desenvolvimento no loopback, CI isolado e sem arquivos externos não confiáveis; acompanhar os mantenedores e substituir ferramentas somente com teste de compatibilidade.

Gitleaks conferiu 204 commits e uma fotografia dos arquivos rastreados/novos publicáveis, sem vazamentos detectados. A fotografia excluiu arquivos ignorados, credenciais locais, dependências e saídas de build. Uma varredura sem esse filtro também encontrou conteúdo em artefatos locais ignorados; não confundir isso com prova de publicação desses valores. Nenhum valor foi mostrado ou adicionado ao Git.

As provas e os limites desta rodada estão em `.work/LOG.md`. Testes locais não certificam a configuração de produção nem uma conexão bancária real.
