import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { fetchComTimeout } from "./fetch";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchComTimeout } }
  );
}
