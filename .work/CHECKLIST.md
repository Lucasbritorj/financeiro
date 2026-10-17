# Obra atual — Planejamento e importação segura
Spec: docs/specs/planejamento-e-importacao-segura.md.
- [x] CA1: revisão e confirmação conjunta de datas.
- [x] CA2: edição invalida confirmação e mantém bloqueios.
- [x] CA3: 12 meses por cartão com registrado/previsões.
- [x] CA4: ciclos corretos e sem dupla contagem.
- [x] CA5: histórico e prévia sem gravação.
- [x] CA6: reversão atômica, idempotente e reimportação.
- [x] CA7: pagamentos, edições, ambiguidades e isolamento protegidos.
- [x] CA8: vencimentos e próximas cobranças em 7 dias.
- [x] CA9: possíveis aumentos e contratos duplicados.
- [x] CA10: jornadas autenticadas em CI local efêmero.
- [x] CA11: vazio, falha e migração ausente explícitos.
- [x] CA12: responsivo, temas, teclado, axe e Lighthouse.
- [x] Fase 1: domínio e revisão de datas, vermelho/verde.
- [x] Fase 2: persistência e histórico de reversão.
- [x] Fase 3: Planejamento, alertas e jornada visual.
- [x] Fase 4: CI, segurança e revisão.

# Histórico — Corrigir fatura Itaú (17/10/2026)
Spec: docs/specs/corrigir-fatura-itau.md.
- [x] CA1: escolha explícita e bloqueio de fatura como extrato.
- [x] CA2: colunas preservadas com dados fictícios.
- [x] CA3: seções atuais/futuras/pagamentos/ofertas separadas.
- [x] CA4: valor em reais e IOF reconciliados.
- [x] CA5: valor futuro explícito preservado na previsão.
- [x] CA6: datas revisadas e competência validada.
- [x] CA7: sugestões de assinaturas com decisão obrigatória.
- [x] CA8: conferência bloqueia inconsistência.
- [x] CA9: SQL local, idempotência e isolamento.
- [x] CA10: painel/Análise por competência sem duplicação.
- [x] CA11: fallback honesto e mês selecionável.
- [x] CA12: jornada, acessibilidade e regressões.
- [x] Fase A: testes vermelhos.
- [x] Fase B: leitura e revisão.
- [x] Fase C: integridade e competência.
- [x] Fase D: jornada e entrega revisada.
- [x] Publicação autorizada em 17/10: cópia privada, migração e preservação das 14 tabelas conferidas.
- [x] PR14 integrado após checks e prévia aprovados; CI pós-merge aprovado.
- [x] Produção READY no domínio principal; verificações de acesso, navegador e erros conferidas.

---

# Histórico — Importação de faturas (17/10/2026)
Spec: docs/specs/importar-faturas-cartao.md. Execução autorizada; marcas correspondem às provas locais registradas no LOG.
- [x] CA1: cinco formatos compartilham revisão; Itaú PDF tem exemplos testados e limites explícitos.
- [x] CA2: cartão e mês confirmados; conta sem cadastros orientada.
- [x] CA3: gasto/parcela/possível assinatura com evidência e correção.
- [x] CA4: parcela atual efetiva e futuras previstas, sem passado inventado.
- [x] CA5: cobrança posterior concilia previsão sem duplicidade.
- [x] CA6: assinatura confirmada ou vinculada sem segunda despesa.
- [x] CA7: pagamento/total/juros/créditos tratados com limites claros.
- [x] CA8: subtotais, descartadas e divergências revisáveis.
- [x] CA9: reenvio, concorrência e ambiguidade sem duplicação.
- [x] CA10: isolamento e lote integralmente atômico.
- [x] CA11: regressões do extrato bancário preservadas.
- [x] CA12: jornada autenticada, celular/desktop, teclado e axe.
- [x] Fase 1: exemplos, contratos e testes vermelhos.
- [x] Fase 2: leitura e reconhecimento.
- [x] Fase 3: persistência e conciliação.
- [x] Fase 4: revisão na interface.
- [x] Fase 5: jornada completa e regressões.
- [x] Fase 6: segurança, revisão e preparação da entrega (PR #13 em rascunho; instalação/publicação separadas).

---

# Checklist — Fechar jornadas financeiras
## Rodada atual: Central de Assinaturas
- [x] CA1: integrar central e preservar entregas atuais; auditoria no CI.
- [x] CA2: custos e próximas cobranças corretos.
- [x] CA3: cadastros/status persistentes, isolamento e falhas recuperáveis.
- [x] CA4: motor sem duplicidade e compatível com ordem das migrações.
- [x] CA5: jornada real local desktop/celular e interface conferida.
- [x] CA6: gate, SQL, segurança, revisão e documentação.
- [x] Fase A: regressões e incorporação.
- [x] Fase B: consistência e jornadas.
- [x] Fase C: entrega revisada.

## Histórico da entrega anterior
- [x] CA1: consumo coerente entre Análise e Dashboard.
- [x] CA2: relatórios sem truncamento silencioso.
- [x] CA3: navegar histórico de faturas.
- [x] CA4: recuperação de senha.
- [x] CA5: exportação CSV autenticada e completa.
- [x] CA6: edição segura de cadastros.
- [x] CA7: jornadas financeiras verificadas localmente.
- [x] CA8: procedimento de instalação e pendências atualizado.
- [x] CA9: corrigir alertas altos das dependências existentes.
- [x] Fase 1: relatórios e histórico.
- [x] Fase 2: recuperação.
- [x] Fase 3: CSV.
- [x] Fase 4: edições.
- [x] Fase 5: jornadas e instalação.
- [x] Fase 6: provas finais e revisão.
- [x] Fase 7: publicação autorizada, função anterior preservada, migração aplicada e permissões conferidas.
- [x] Produção preparada sem domínio, cinco rotas verificadas e mesma versão promovida.
- [x] URL de recuperação existente confirmada pelo Lucas; proteção da Vercel preservada.

Envio real de e-mail, políticas Auth e backup integral permanecem como verificações operacionais em docs/pendencias-atuais.md.
