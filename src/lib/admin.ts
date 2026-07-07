import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

export async function requireSupervisor() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized", status: 401, supabase: null, user: null };
  }

  const { data: isSupervisor, error } = await supabase.rpc("is_supervisor", { user_uuid: user.id });
  if (error) {
    console.error("is_supervisor RPC error:", error);
    return { error: `Auth check failed: ${error.message}`, status: 500, supabase: null, user: null };
  }
  if (!isSupervisor) {
    return { error: "Forbidden — supervisor only", status: 403, supabase: null, user: null };
  }

  return { error: null, status: 200, supabase, user };
}
