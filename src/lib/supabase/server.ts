import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { fetchComTimeout } from "./fetch";

export async function createClient(response?: NextResponse) {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchComTimeout },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          if (response) {
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
            return;
          }
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Chamado de um Server Component: o proxy renova a sessão.
          }
        },
      },
    }
  );
}
