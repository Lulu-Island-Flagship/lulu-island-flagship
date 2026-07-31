"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

// Componente de efecto secundario puro, sin UI (return null). Se monta una
// sola vez en el layout raíz (src/app/[locale]/layout.tsx) y escucha los
// cambios de estado de auth del MISMO cliente browser que ya usa
// AuthModal.tsx (@/lib/supabase, createBrowserClient) -- no crea una
// segunda instancia ni duplica ninguna lógica de autenticación.
//
// Cuando el usuario completa sign-in (por cualquiera de los métodos ya en
// producción: Google/Apple OAuth, email OTP, phone OTP), dispara una
// llamada en segundo plano a /api/client-module/ensure-registered para
// vincular/crear su fila en `clients` (módulo CRM nuevo). Esto es
// puramente aditivo y NO CRÍTICO para el flujo de compra/reserva: si falla
// (red, servidor caído, lo que sea), se traga el error en silencio -- el
// usuario nunca debe ver ni sentir un fallo aquí, ya que su sesión de auth
// real ya se estableció correctamente antes de que este efecto corra.
export function EnsureClientRegistration() {
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        fetch("/api/client-module/ensure-registered", { method: "POST" }).catch(
          (error) => {
            // Solo para debugging local -- nunca debe llegar a afectar la
            // UX del login existente.
            console.error("EnsureClientRegistration: background call failed", error);
          }
        );
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
