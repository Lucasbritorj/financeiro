# Execução — Importação de faturas (17/10/2026)
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
- [ ] Fase 6: segurança, revisão e preparação da entrega.

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
