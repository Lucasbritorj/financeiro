# Correções de vínculo Pluggy e expansão XLSX

Pronto significa: CA1–CA5 comprovados por testes, SQL descartável, lint e build; revisão independente sem bypass confirmado. Instalação e publicação foram autorizadas posteriormente pelo titular em 19/10/2026 e são registradas em .work/LOG.md.

## Objetivo
Fechar os dois achados baixos da auditoria sem alterar dados financeiros existentes ou outras funções em construção.

## Histórias
- Como titular, quero que apenas o servidor valide e vincule uma conta bancária autorizada.
- Como usuário, quero rejeitar planilhas perigosas antes de o leitor criar uma planilha em memória.

## Critérios de aceite
- CA1: dado acesso anon/authenticated à RPC antiga ou nova, quando tenta reservar um ID externo, então recebe recusa; somente service_role pode executar o novo vínculo com titular explícito e conta pertencente a ele.
- CA2: dada solicitação legítima à rota Pluggy, quando titular, conta interna e conta do provedor são validados, então o servidor vincula sem expor sua credencial; ausência da configuração privilegiada retorna indisponibilidade, sem gravação ou fallback inseguro. Repetição idêntica mantém um vínculo e erros não revelam credenciais.
- CA3: dado XLSX, quando sua expansão real ultrapassa 8 MiB por entrada, 24 MiB no total ou 256 entradas, então é recusado antes do ExcelJS; limites declarados falsos não permitem expansão ilimitada.
- CA4: dados ZIPs ambíguos, duplicados, criptografados, ZIP64 ou malformados e XML com dimensões excessivas, quando recebidos, então são recusados; ExcelJS recebe apenas ZIP STORE canônico já validado. Limites: 10 mil linhas, 256 colunas, 100 mil elementos XML no total e 100 mil posições agregadas em nomes definidos, com intervalos canônicos.
- CA5: dado XLSX financeiro normal STORE/DEFLATE, quando importado como extrato ou fatura, então conteúdo e revisão são preservados; CSV/OFX/PDF não mudam.

## Casos de borda
RPC legada, service_role sem usuário, conta de outro usuário, duplicidade e conflito, segredo ausente, corpo forjado, ZIP com data descriptor, divergência central/local, nomes Unicode e traversal, entradas sobrepostas, stream acima do declarado, sparse row/col/cell, navegador sem deflate-raw.

## Fora do escopo
Publicação, credenciais reais, alterações .env, migração remota, alertas de dependências de desenvolvimento, recertificar a auditoria selada.

## Perguntas abertas e premissas
Nenhuma impeditiva: SUPABASE_SERVICE_ROLE_KEY será requisito privado somente para vincular Pluggy. Não será lida de arquivos nem configurada nesta etapa. Sem suporte nativo a deflate-raw, orientar usar navegador atualizado ou CSV; sem fallback inseguro.

## Premissas e garantias
1. Banco: vínculo e histórico na mesma transação.
2. Repetição idêntica não duplica vínculo nem histórico.
3. Conta travada na escrita; UNIQUE protege exclusividade global.
4. Timeouts do provedor preservados; nenhuma API externa real nos testes.
5. Busca por PK e usuário; nenhum novo loop de consultas.
6. ZIP validado com limites reais antes do decoder e RPC restrita no próprio banco.
7. Trade-off: ZIPs exóticos ou planilhas grandes são rejeitados para limitar memória; formatos financeiros normais e revisão humana preservados. Sem dependência nova.
