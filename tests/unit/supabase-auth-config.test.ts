import { test } from "node:test";
import assert from "node:assert/strict";
import { lerConfigToml, lerSecaoToml } from "./_config-toml.ts";

// Enforcement do checklist de produção que antes vivia só em prosa no
// README (ver commit que substitui os 3 itens em texto por este teste).
//
// IMPORTANTE: config.toml governa o ambiente LOCAL (supabase start). Só
// reflete no projeto remoto se alguém rodar `supabase config push` depois
// de mudar este arquivo — um teste verde aqui não é prova de que o painel
// de produção está correto, é prova de que o ARQUIVO VERSIONADO está.

const toml = lerConfigToml();

test("auth.minimum_password_length é >= 8 (checklist de produção)", () => {
  const auth = lerSecaoToml(toml, "auth");
  assert.equal(typeof auth.minimum_password_length, "number");
  assert.ok(
    (auth.minimum_password_length as number) >= 8,
    `minimum_password_length é ${auth.minimum_password_length}, checklist exige >= 8`,
  );
});

test("auth.email.enable_confirmations está ligado (checklist de produção)", () => {
  const authEmail = lerSecaoToml(toml, "auth.email");
  assert.equal(
    authEmail.enable_confirmations,
    true,
    "enable_confirmations está false — usuário pode logar sem confirmar e-mail",
  );
});

test("auth.rate_limit.sign_in_sign_ups não excede 30 por 5min (trava contra remoção acidental)", () => {
  const rateLimit = lerSecaoToml(toml, "auth.rate_limit");
  assert.equal(typeof rateLimit.sign_in_sign_ups, "number");
  assert.ok((rateLimit.sign_in_sign_ups as number) <= 30);
});
