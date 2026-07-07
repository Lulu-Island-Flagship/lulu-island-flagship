import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const supabase = createServerClient(
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/");
  }

  const { data: isSupervisor } = await supabase.rpc("is_supervisor", { user_uuid: user.id });
  if (!isSupervisor) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin Nav */}
      <nav className="bg-brand-navy text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <a href="/admin" className="font-bold text-lg">Admin</a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/admin/servicios" className="hover:text-brand-gold transition-colors">Services</a>
            <a href="/admin/empleados" className="hover:text-brand-gold transition-colors">Employees</a>
            <a href="/admin/upsells" className="hover:text-brand-gold transition-colors">Upsells</a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
