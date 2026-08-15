"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Auditoría UX/accesibilidad 2026-07-25 (#4, empleado): varios diálogos
 * modales (SafetyAbortButton, ChemicalMatchModal, HoursDisputeButton,
 * votacion/page.tsx) no tenían role="dialog"/aria-modal ni ningún trap de
 * foco -- Tab podía escaparse del modal hacia el contenido de fondo, y
 * Escape no cerraba nada. Este hook es intencionalmente simple (no una
 * librería nueva): mientras `active` es true, cicla Tab/Shift+Tab dentro
 * de los elementos focuseables del contenedor y Escape invoca `onClose`.
 * Al montar, mueve el foco al primer elemento focuseable del modal; al
 * desmontar/cerrar, devuelve el foco a lo que estaba enfocado antes.
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onClose?: () => void
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  // Fix (auditoría 2026-07-31, item 16): el efecto de abajo depende solo de
  // `active` (a propósito -- ver comentario en el array de dependencias),
  // así que closeaba sobre el `onClose` recibido la primera vez que
  // `active` pasó a true. Si el caller pasa un `onClose` inline (común,
  // ej. `() => setOpen(false)` con datos capturados de un render
  // posterior), Escape podía invocar una versión vieja. Se guarda la
  // referencia más reciente en un ref, actualizado en CADA render (sin
  // dependencias, no dispara efectos), y `handleKeyDown` llama
  // `onCloseRef.current` en vez de cerrar directamente sobre el parámetro.
  // Así Escape siempre ve el `onClose` más reciente sin necesidad de
  // re-ejecutar el setup/teardown de foco en cada re-render del padre
  // (que sí pasaría si `onClose` estuviera en el array de dependencias del
  // efecto sin que el caller lo memoice con useCallback).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      if (!node) return [];
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    }

    const focusable = getFocusable();
    (focusable[0] || node).focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
