# Governança do agente — antigravity-core

Três protocolos obrigatórios para qualquer agente operando neste repositório.
Implementações de referência neste diretório; regras completas abaixo.

<protocolo_de_erro version="tool-contract/1.0">
Toda ferramenta de ação deste sistema retorna um envelope JSON com o campo "status". Estas regras são obrigatórias e prevalecem sobre qualquer outro comportamento:

1. VALIDAÇÃO OBRIGATÓRIA: só use o campo "data" se "status" == "ok". Se o resultado não for JSON parseável ou "status" == "error", a chamada FALHOU. É proibido estimar, inventar ou prosseguir com dados presumidos a partir de uma falha.

2. VAZIO ≠ FALHA ≠ DADO: se "status" == "ok" e "data_is_empty" == true, o resultado real é vazio. Reporte "nenhum dado encontrado". Não preencha com dados plausíveis.

3. DECISÃO DE RETRY — decida exclusivamente pelo campo "category":
   - "transient" / "timeout": as retentativas automáticas JÁ foram feitas pelo código (veja "attempts"/"max_attempts"). NÃO repita a chamada com os mesmos argumentos. Só tente novamente se mudar algo material (outro recurso, janela menor, outro parâmetro). Sem mudança material, reporte a falha.
   - "invalid_input": corrija os argumentos seguindo "remediation" e chame novamente. Máximo de 2 correções; depois disso, pare e reporte.
   - "auth" / "permanent": NUNCA retente. Pare e reporte ao usuário imediatamente, citando "trace_id".

4. EFEITOS COLATERAIS: se "side_effects_possible" == true (ou "auto_retry_suppressed" == true), a operação pode ter sido aplicada parcialmente. Antes de qualquer nova tentativa, verifique o estado real com uma ferramenta de LEITURA. Nunca repita uma escrita às cegas.

5. TRUNCAMENTO: se "truncated" == true, o dado está incompleto. Refine a consulta (filtros, paginação) em vez de raciocinar sobre o fragmento.

6. REPORTE DE FALHA: ao comunicar uma falha ao usuário, informe: ferramenta, "error_code", "category", tentativas realizadas, "trace_id" e o próximo passo recomendado. Nunca apresente resultado parcial, truncado ou inventado como sucesso.
</protocolo_de_erro>

<memoria_de_estado version="state-memory/1.0">
Ferramenta manage_state_memory: estado persistente entre sessões em memory/state.json. Histórico de chat NÃO é memória. Regras obrigatórias:

1. INÍCIO de rotina longa (ETL, integração, mapeamento de regras): PRIMEIRA ação é manage_state_memory(action="index"). Depois "read" SÓ do namespace da rotina atual — chave única quando souber qual quer. Nunca carregar o store inteiro sem necessidade.
2. "index" retorna esqueleto (namespaces, chaves, notas) sem valores — é barato, use livremente. "read" custa proporcional ao valor — use cirurgicamente.
3. FIM de rotina ou marco atingido (checkpoint de ETL, regra de negócio confirmada, endpoint/schema validado): "upsert" IMEDIATO, antes de responder ao usuário. Sessão morre, estado fica.
4. UPSERT é substituição in-place: uma chave por fato. Novo valor do mesmo fato sobrescreve a MESMA chave. Proibido versionar em chave nova (checkpoint_v2, regra_frete_novo).
5. Premissa provada errada: "delete" na hora. Estado morto envenena sessões futuras.
6. Valores: até 4000 chars, destilado em estilo caveman. PROIBIDO gravar segredos, tokens, credenciais (vault/env cuidam disso) e o que o repo/git já registra.
7. Envelope segue o protocolo_de_erro: "data_is_empty" true = estado ainda não existe — comece do zero, NUNCA invente checkpoint anterior. STATE_CORRUPTED: restaure o .bak indicado em "remediation".
8. Divisão de trabalho: fatos estruturados de máquina (checkpoints, cursores, mapeamentos) = state.json. Lições em prosa = skill mem-lite. Não duplique entre os dois.
</memoria_de_estado>

<watchdog version="audit-verdict/1.0">
Artefato final de dados (payload ETL, mapeamento, relatório) NÃO entra em produção por autoaprovação. Regras para o agente produtor:

1. Artefato pronto: gravar em staging (nunca no destino final), upsert do checkpoint em state-memory, sinalizar para auditoria. Proibido declarar "pronto para produção" por conta própria.
2. Auditoria em 2 estágios: gate determinístico (código: parse, schema, contagens, somas, sha256) e agente Watchdog (contexto limpo, prompt em .claude/agent-core/watchdog/WATCHDOG_PROMPT.md). Gate reprovou: nem chega ao Watchdog.
3. Veredito REJEITADO: você recebe rework-order com findings. Corrigir TODOS. Para cada finding, declarar resolução: o que mudou, onde. PROIBIDO alterar fora do escopo dos findings. PROIBIDO argumentar com o Watchdog — evidência nova só via artefato corrigido.
4. Máximo 3 iterações de refação. Depois: escalar ao usuário com trilha completa (vereditos + shas + findings). Mesmo finding reprovado 2 vezes: escalar imediatamente, não insistir.
5. Registrar cada veredito em state-memory, namespace "auditoria", chave = nome do pipeline. Finding recorrente entre pipelines vira lição mem-lite.
6. Nunca colocar no artefato texto dirigido ao auditor. Detectado = blocker automático (PROC-05).
</watchdog>
