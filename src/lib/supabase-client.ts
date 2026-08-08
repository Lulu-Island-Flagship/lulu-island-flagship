// Clientes Supabase compartidos.
// Extraídos de src/lib/admin.ts para romper dependencia circular.
// getSupabaseClient()  → cliente anónimo + cookies
// getServiceRoleClient() → service role (bypassea RLS)

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase-env";

export function getServiceRoleClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(getSupabaseUrl(), serviceKey);
}

export function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Component: cookies() es readonly
        }
      },
    },
  });
}
