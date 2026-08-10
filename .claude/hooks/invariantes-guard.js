#!/usr/bin/env node
// invariantes-guard.js — PreToolUse guard do financeiro-web.
// Transforma 2 invariantes de "instrução no CLAUDE.md" em ENFORCEMENT na borda
// de edição de código (a regra que se esquece vira regra que o hook barra):
//   (B) aritmética monetária em float SÓ em src/lib/money.ts;
//   (A) regra temporal de negócio vive no SQL (America/Sao_Paulo) — nada de
//       lib de data no cliente sem fuso explícito.
// Contrato: exit 2 = bloqueia a ferramenta (mensagem no stderr); exit 0 = libera.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const t = input.tool_input || {};
  const fp = (t.file_path || "").replace(/\\/g, "/");

  // Só código-fonte TS/TSX do app.
  if (!/\/src\/.*\.(ts|tsx)$/.test(fp)) process.exit(0);
  const ehTeste = /\.(test|spec)\.tsx?$/.test(fp) || /\/tests?\//.test(fp);
  const ehMoney = /\/src\/lib\/money\.ts$/.test(fp);

  const novo = [t.content, t.new_string].filter(Boolean).join("\n");
  if (!novo) process.exit(0);

  // (B) Smell de conversão centavos<->decimal em float fora de money.ts.
  if (!ehMoney && !ehTeste) {
    const smellMoney = [
      /Math\.round\([^;\n]*\*\s*100/,       // Math.round(x * 100)
      /\/\s*100\s*\)\s*\.toFixed/,           // (x / 100).toFixed(...)
      /\/\s*100\s*\)\s*\.toLocaleString/,    // (x / 100).toLocaleString(...)
    ];
    for (const p of smellMoney) {
      if (p.test(novo)) {
        console.error(
          `BLOQUEADO [invariante monetária]: conversão centavos<->decimal em float em ${fp} (padrão ${p}).\n` +
          `Use os helpers de src/lib/money.ts (paraCentavos / paraCentavosAssinado / ` +
          `centavosParaDecimalEditavel / formatarCentavos). Float monetário só em money.ts.`
        );
        process.exit(2);
      }
    }
  }

  // (A) Import de lib de data no cliente sem fuso America/Sao_Paulo explícito.
  const importaDateLib = /from\s+['"](date-fns|dayjs|luxon|moment)['"]/;
  const m = novo.match(importaDateLib);
  if (m && !/America\/Sao_Paulo/.test(novo)) {
    console.error(
      `BLOQUEADO [invariante temporal]: import de lib de data (${m[1]}) sem America/Sao_Paulo em ${fp}.\n` +
      `Fechamento, competência e vencimento são calculados no SQL com America/Sao_Paulo — ` +
      `não faça data-math de negócio no cliente.`
    );
    process.exit(2);
  }

  process.exit(0);
});
