"use client";

// Fix 2026-07-24 (auditoría /cuenta): src/app/[locale]/cuenta/ tiene
// layout.tsx (guarda de sesión, v8.3 fix auditoría B-1) y 5 subcarpetas
// (servicios, propiedades, billetera, referidos, preferencias) pero nunca
// tuvo un page.tsx en la raíz -- entrar directo a /cuenta (p.ej. escribiendo
// la URL a mano, o cualquier link futuro que apunte ahí) daba 404 aunque el
// layout que envuelve la ruta sí exista y funcione.
//
// No hay navegación compartida entre las subsecciones de /cuenta (revisado:
// cuenta/layout.tsx solo hace de auth guard, ninguna subpágina enlaza a las
// demás) ni un patrón de "dashboard resumen" en el resto del sitio. En
// cambio, el link "Iniciar sesión" del home (src/app/[locale]/page.tsx,
// líneas ~116 y ~132) ya usa `/${locale}/cuenta/servicios` como EL destino
// canónico de la cuenta del cliente. Para no inventar una landing nueva sin
// precedente, /cuenta simplemente redirige ahí -- mismo destino que ya usa
// el resto del sitio.
import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function CuentaIndexPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";

  useEffect(() => {
    router.replace(`/${locale}/cuenta/servicios`);
  }, [router, locale]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
    </div>
  );
}
