<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Execução focada

- Use esta raiz; não misture alterações com outras cópias do financeiro.
- Unitário pontual: `node --test tests/unit/<arquivo>.test.ts`; exemplo: `node --test tests/unit/money.test.ts`.
- Componente pontual: `npm run test:componentes -- tests/componentes/<arquivo>`.
- Amplie para testes dependentes ao alterar dinheiro, persistência, SQL ou autenticação; não dispense invariantes de domínio.
- Scripts de entrega disponíveis: `npm run lint`, `npm run build`, `npm run gate`, `npm run smoke` e `npm run test:sql`; selecione por impacto e exigência de CI.
- Confirme alvo local e requisitos antes de testes SQL; nunca execute testes/migrações contra banco remoto por suposição.
- Não repita suítes válidas sem alteração relevante, falha ou risco novo. Preserve a consulta dirigida à documentação Next.js acima.
