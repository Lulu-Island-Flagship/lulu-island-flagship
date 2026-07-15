import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/empleado/ServiceWorkerRegister";
import { SafetyAbortButton } from "@/components/empleado/SafetyAbortButton";

// v8.3 E7 (D.10 #7): el botón de aborto seguro (SOS) se monta aquí para
// estar disponible en TODA página del área de empleado, no solo la de un
// servicio activo -- antes, safety-abort/route.ts existía pero ningún
// componente lo invocaba, el SOS era inalcanzable en la práctica.
export default function EmpleadoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ServiceWorkerRegister />
      {children}
      <SafetyAbortButton />
    </>
  );
}
