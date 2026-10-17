import { execFileSync, spawnSync } from "node:child_process";

// Chaves obtidas apenas da instância local, nunca de arquivo .env ou projeto remoto.
const windows = process.platform === "win32";
const status = JSON.parse(execFileSync(windows ? "supabase.cmd" : "supabase", ["status", "-o", "json"], { encoding: "utf8", shell: windows, stdio: ["ignore", "pipe", "ignore"] }));
if (new URL(status.API_URL).origin !== "http://127.0.0.1:54321") throw new Error("Inicie o Supabase local desta raiz na porta 54321.");
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  E2E_LOCAL_SERVICE_ROLE: status.SERVICE_ROLE_KEY, E2E_LOCAL: "1", E2E_PORT: "3100" };
function executar(comando, args) {
  const result = spawnSync(comando, args, { env, stdio: "inherit", shell: windows && comando !== process.execPath });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
executar(windows ? "npm.cmd" : "npm", ["run", "build"]);
executar(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--project=desktop-1440", "--project=mobile-320", "--workers=1"]);
