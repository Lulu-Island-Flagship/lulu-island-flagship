# REPORTE DE AUDITORÍA PROFUNDA E4-E5 — Ejecución Física, QC y Cierre
**Fecha:** 8 de julio, 2026 | **Contra:** v8.3 | **Método:** lectura línea por línea del código real (no inventario superficial)

---

## E4 — EJECUCIÓN FÍSICA

| Criterio v8.3 | Estado | Evidencia |
|---|---|---|
| Geocerca real T_in/T_out | ✅ PASA | `haversineDistance()` en `geocode.ts` (fórmula real, no simulada), radio 200m, comparado contra coordenadas geocodificadas de la orden. Bypass manual con motivo obligatorio si falla el GPS (queda registrado como nota de auditoría). |
| Timeline de eventos (T_in/T_start/T_out/foto/nota) | ✅ PASA | `service_logs` con secuencia validada en servidor: no permite T_start sin T_in, ni T_out sin T_start (`servicio/route.ts` líneas 82-87). |
| Checklist de cierre por zona con fotos | ✅ PASA (parcial) | `ChecklistCierre.tsx` + `sop_checklists`: zonas, items requeridos marcados con `*`, foto adjuntable por item. |
| **Poka-yoke químico con BLOQUEO** | ❌ **FALTA** | `CodigoCromático.tsx` es solo una tarjeta de referencia visual (color+ícono+texto), **no bloquea nada**. No está enlazado a ninguna acción del checklist ni valida que el empleado usó el producto correcto en la zona correcta. El spec pide un poka-yoke que impida continuar si hay mismatch — hoy es un cartel informativo, no un candado. |
| **T_out exige checklist completo (5 requisitos de cierre)** | ❌ **FALTA** | `servicio/route.ts` línea 85: T_out solo verifica que el status previo sea `in_progress`. **No verifica `overallProgress.percentRequired`, ni fotos obligatorias, ni ningún otro requisito.** Un empleado puede terminar el servicio sin haber completado un solo ítem del checklist. Esto es una brecha operativa real, no cosmética. |
| Fotos WebP con límites de tamaño | ❌ FALTA | Upload sube el archivo tal cual (`file.type` original) a Supabase Storage, sin conversión a WebP ni validación de tamaño/dimensiones en cliente o servidor. |
| **PWA offline-first (manifest, service worker, IndexedDB)** | ❌ **FALTA POR COMPLETO** | Confirmado por búsqueda directa: no existe `manifest.json`, no hay `service-worker`, no hay Workbox en `package.json`, no hay `next-pwa`. Las páginas de empleado son 100% online-only. Sigue siendo, como se documentó antes, el hueco estructural más grande del proyecto — sin señal en campo, el empleado no puede operar. |
| Protocolo Airbnb / zonas editables por admin | 🟡 No verificado a fondo (queda para siguiente pasada) | |

**Conclusión E4:** lo que existe (geocerca, timeline, checklist) es sólido y funcional como base de UI online. Pero dos hallazgos son graves porque rompen la integridad del dato que alimenta todo lo demás (QC, score, garantías): el poka-yoke químico no bloquea nada, y el cierre del servicio no exige evidencia. Sumado a la ausencia total de arquitectura offline, E4 sigue siendo más construcción nueva que retrofit.

---

## E5 — QC Y CIERRE DE CICLO

| Criterio v8.3 | Estado | Evidencia |
|---|---|---|
| Score compuesto (telemetría 50% + auditoría 30% + peer 20%) | ✅ PASA | `recalculate_weekly_score()` en migración 011: fórmula completa y correcta — telemetría con bonos/penalizaciones por disputa/discrepancia/QC/upsell/puntualidad, auditoría como **promedio móvil de las últimas 5 evaluaciones** (exactamente como pide el spec), peer votes promediado. Clamps correctos [0,50]/[0,30]/[0,20]. |
| Niveles de confianza (élite/estándar/observación/suspendido) | ✅ PASA | Umbrales: ≥90 élite, ≥70 estándar, ≥50 observación, <50 suspendido. Persistido en `employees.trust_level`, usado después en despacho (zona/trust sorting confirmado en E3). |
| Canal de apelación | ✅ PASA | `empleado/appeal` + campos `appealed_at`/`appeal_reason`/`appeal_resolved_at` en `field_audits` — existe de verdad, no es solo un botón decorativo. |
| **Auditor de Campo — despacho probabilístico 20%** | ❌ **FALTA** | `admin/audits/route.ts`: el auditor **elige manualmente** qué orden completada auditar de una lista; no hay ningún mecanismo que seleccione automáticamente ~20% de servicios al azar para auditoría sorpresa. El `dispatch_probability` que sí existe en el código es otra cosa — calcula la probabilidad de anunciar el resultado al cliente, no de qué se audita. Confirma el hallazgo previo de E3, ahora con evidencia de código, no solo inventario. |
| **Anti-gaming en peer votes** | ❌ **FALTA** | `votacion/route.ts`: bloquea auto-voto y voto duplicado por semana (bien), pero no hay ninguna detección de colusión (votos recíprocos sistemáticos, outliers, mínimo de votantes distintos para que el promedio cuente). Un grupo de 2-3 empleados podría inflarse mutuamente el score sin que nada lo detecte. |
| Anti-gating de reseñas (token para TODOS los cierres) | ✅ PASA | Confirmado en migración 014: el trigger `trigger_generate_review_token_on_complete()` genera el token **incondicionalmente** en cuanto `status` pasa a `completed` — no hay ningún filtro por score, calificación esperada, ni tipo de cliente. Ventana de 24h validada correctamente en `evaluar/[token]/page.tsx`. |
| Sentimiento multilenguaje (word boundaries) | ✅ PASA (ya confirmado en sesión anterior, migración 015) | |
| Garantía relacional end-to-end | 🟡 Depende de E4 | No se puede verificar de punta a punta porque el cierre no obliga evidencia fotográfica (ver hallazgo de E4 arriba) — es la misma cadena rota. |

**Conclusión E5:** el motor de score es, hasta ahora, lo mejor construido de todo el proyecto — la fórmula matemática coincide con el spec en detalle, no solo en intención. Los dos huecos reales son el mismo patrón que en E4: falta el mecanismo *automático/aleatorio* que impide manipulación humana (auditoría sorpresa, anti-colusión de votos). Todo lo que depende de la buena fe del empleado o del admin está construido; todo lo que debía ser un candado automático, no.

---

## Hallazgos que requieren decisión o eran ambiguos (no toqué nada, solo documento)

1. El poka-yoke químico y el bloqueo de T_out son cambios de comportamiento operativo (podrían frustrar a empleados legítimos si se activan mal) — recomiendo construirlos pero probarlos contigo antes de hacerlos obligatorios en producción.
2. El despacho probabilístico de auditorías y el anti-gaming de votos son puramente aditivos (no cambian nada existente, solo agregan una capa) — son candidatos seguros para que yo los construya sin necesitar tu aprobación.

---

*(Fin del reporte — continúo con el resto de la auditoría según lo acordado.)*
