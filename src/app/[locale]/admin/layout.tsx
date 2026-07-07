import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import AdminLoginScreen from "@/components/admin/AdminLoginScreen";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

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
    return <AdminLoginScreen />;
  }

  const { data: isSupervisor } = await supabase.rpc("is_supervisor", { user_uuid: user.id });

  if (!isSupervisor) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-brand-ink">Admin Access</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left text-sm space-y-2">
            <p><strong>Status:</strong> Not authorized</p>
            <p><strong>User email:</strong> {user.email || "no email"}</p>
          </div>
          <p className="text-sm text-gray-500">
            Your account does not have supervisor privileges.
          </p>
          <a
            href="/"
            className="inline-block bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            Go to Home
          </a>
        </div>
      </div>
    );
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
            <a href="/admin/checklists" className="hover:text-brand-gold transition-colors">Checklists</a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
