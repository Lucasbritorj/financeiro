# Correções da auditoria de segurança
**Pronto significa:** critérios locais comprovados por testes reais; infraestrutura externa instalada somente quando houver acesso verificado, com limites explícitos.
Status: aprovada por Lucas em 2026-10-21; plano da auditoria autorizado, sem nova aprovação de implementação necessária.

## Objetivo
Corrigir as fronteiras de sessão, abuso, erros e recuperação identificadas na auditoria sem perder funcionalidades financeiras ou alterações preexistentes.
## Histórias
- Como titular, quero sessão protegida, saída confiável e mensagens sem detalhes internos.
- Como operador, quero limites persistentes, cópias criptografadas e falhas observáveis.
## Critérios de aceite
- CA1: a implementação usa a pasta central atual; nenhuma alteração pendente do worktree antigo é sobrescrita e CSP/XLSX existentes permanecem.
- CA2: consultas atuais de vulnerabilidade não encontram versões afetadas no lockfile; mudanças de ferramentas preservam verificações existentes.
- CA3: cookies emitidos pelo servidor têm Secure em produção, HttpOnly e SameSite; login, recuperação e RPCs continuam funcionando sem tokens de sessão no JavaScript.
- CA4: falha de logout não aparenta sucesso; troca de senha revoga sessões conforme contrato documentado, sem alegar revogação instantânea de JWT já emitido.
- CA5: chamadas custosas e exportações têm limite atômico persistente antes da execução; excesso retorna 429 e indisponibilidade recusa a operação.
- CA6: ações autenticadas por cookie exigem origem própria e entradas limitadas; ponte de dados não permite destinos arbitrários nem privilégios administrativos.
- CA7: erros de infraestrutura não aparecem na interface; mensagens de negócio reconhecidas continuam úteis.
- CA8: cópias novas são autenticadas/criptografadas, restauração confere integridade e a rotina automática impede sobreposição e registra sucesso/falha sem segredos.
- CA9: eventos de segurança têm saída estruturada sem dados financeiros, senhas ou tokens; alerta externo e cópia externa somente com destino privado validado.
- CA10: configurações remotas são conferidas por acesso disponível; impedimentos concretos são registrados, sem inventar instalação/publicação.
- CA11: unidade, componentes, SQL local, build/lint, segurança e revisão independente aprovam as fronteiras alteradas.
## Casos de borda
Rede ausente, sessão expirada, duas abas, chamadas concorrentes, origem ausente/externa, corpo excessivo, falha de revogação, arquivo adulterado, chave ausente e provedor indisponível.
## Fora do escopo
Reescrever funcionalidades financeiras, descartar o worktree antigo, merge em master, instalar serviços pagos ou expor credenciais no GitHub.
## Premissas e garantias
- Atomicidade: limite e contador são uma única operação SQL; cópia só é marcada válida após restauração e criptografia.
- Repetição: não repetir escritas financeiras; scheduler sem execuções sobrepostas.
- Concorrência: contadores persistentes com atualização atômica.
- Dependências: timeout e recusa segura quando autenticação/limite indisponível.
- Consultas: paginação e limites existentes preservados.
- Entradas: origem, caminho, método e tamanho validados no servidor.
- CORS do endpoint público gerenciado não é autorização: preservar RLS; restringir a ponte da aplicação à própria origem.
## Perguntas abertas
Nenhuma para iniciar. Hostinger/alertas dependem de acesso e destino real; não pedir credenciais pelo chat nem declarar configurado sem prova.
