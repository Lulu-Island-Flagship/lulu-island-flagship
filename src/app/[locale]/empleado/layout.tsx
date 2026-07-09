import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/empleado/ServiceWorkerRegister";

export default function EmpleadoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ServiceWorkerRegister />
      {children}
    </>
  );
}
