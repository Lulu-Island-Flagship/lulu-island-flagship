# AUDITORÍA — Suplemento: Hallazgos Adicionales
## Lulu Island Flagship v8.6 | 6 de Agosto, 2026

**Este documento complementa `audit-final-interconnections.md`. Leer ambos.**

---

# 🔴 CRÍTICO #4 — 8 tablas referenciadas en código sin migración

Los siguientes módulos escriben o leen de tablas que **no tienen migración en `supabase/migrations/`**:

| Tabla | Referenciada en | Tipo |
|---|---|---|
| `financial_ledger` | `financial-ledger.ts:630`, `financial-reports.ts:963` | Partida doble |
| `payroll_linea` | `payroll-line.ts`, `payroll-calculator.ts:330` | Nómina |
| `periodo_contable` | `accounting-period.ts` | Cierres contables |
| `coa_version` | `coa-version.ts` | Versionado COA |
| `tax_submission_log` | `tax-submission-log.ts` | Envíos CRA |
| `schema_registry` | `events.ts`, Mejoras8.3 B.23 | Catálogo de eventos |
| `landing_images` (bucket) | spec-v8.5-landing-final.md | Storage de imágenes |
| `coworker_rotation` | `coworker-rotation.ts` | Rotación de equipos |

**Archivo:** `src/lib/financial-reports.ts`, **Línea:** 963
> "Las vistas abajo usan la tabla `financial_ledger` (a crearse en migración futura)."

**Archivo:** `src/lib/financial-ledger.ts`, **Línea:** 630 (COMENTARIO, no migración real)
> CREATE TABLE IF NOT EXISTS financial_ledger ( ... )

**Consecuencias:** El Financial Core de 9 capas no puede funcionar. `payroll_linea` no existe. Los períodos contables no tienen dónde registrarse. El versionado del COA no tiene respaldo en DB.

**Arreglo:** Crear migraciones para las 8 tablas faltantes. Prioridad: `financial_ledger`, `payroll_linea`, `periodo_contable`.

---

# 🟠 ALTO #6 — 25 variables de entorno sin documentar

**Archivo:** `.env.example` — Solo documenta 7 variables. El código usa 33.

Variables faltantes en `.env.example`:

```
BACKUP_ENCRYPTION_KEY       BC_ASSESSMENT_API_KEY       BC_ASSESSMENT_API_URL
EMAIL_FROM_ADDRESS          GEOCODER_API_KEY            GEOCODER_PROVIDER_URL
GOOGLE_PLACES_API_KEY       HIRING_FLOW_ENCRYPTION_KEY  NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_GOOGLE_REVIEW_URL  NEXT_PUBLIC_SOS_EMERGENCY_PHONE
OPENWEATHERMAP_API_KEY      PAYPAL_CLIENT_ID            PAYPAL_CLIENT_SECRET
PAYPAL_ENVIRONMENT          PAYROLL_ENCRYPTION_KEY      RESEND_API_KEY
SENTRY_DSN                  SERVICE_SECRET              TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN           TWILIO_FROM_NUMBER          TWILIO_HUMAN_ESCALATION_NUMBER
VERCEL_ENV                  NODE_ENV
```

**Arreglo:** Agregar las 25 variables a `.env.example` con valores placeholder y comentarios.

---

# 🟠 ALTO #7 — 149 tests pero 0 tests del Financial Core

**Archivos:** `tests/lib/` — 149 archivos de test.

Pero NO existen tests para los módulos más críticos financieramente:
- `financial-ledger.ts` (708 líneas)
- `coa-imputation.ts` (1,037 líneas)
- `payroll-calculator.ts`
- `tax-netfile.ts`
- `events.ts`
- `close-period.ts`
- `accounting-period.ts`

**Arreglo:** Agregar tests para `financial-ledger.ts` (generateJournalEntry, invariante de partida doble, hash), `coa-imputation.ts`, `payroll-calculator.ts`.

---

# 🟠 ALTO #8 — `cra-client.ts` tiene placeholder tokens

**Archivo:** `src/lib/cra-client.ts`, **Línea:** 210
> accessToken: `cra-placeholder-token-${Date.now()}`,

**Archivo:** `src/lib/t4-submission.ts`, **Línea:** 201
> sin_encrypted como placeholder — el descifrado real...

El cliente de CRA para NETFILE usa tokens placeholder. GST returns no se pueden enviar electrónicamente.

**Arreglo:** Integrar con CRA Web Service (requiere registro, certificado digital, credenciales NETFILE). Mientras tanto, documentar que NETFILE está en modo "generar XML sin enviar".

---

# 🟡 MEDIO #6 — Dispatch scheduler tenía bug de RLS en producción

**Archivo:** `src/app/api/cron/dispatch-scheduler/route.ts`, **Línea:** 20-34
> este cron construía su cliente Supabase con createServerClient + cookies() [...]
> Vercel Cron invoca esta ruta server-to-server [...] NUNCA hay cookies de sesión.
> Eso significa auth.uid() evalúa NULL [...] y las políticas RLS BLOQUEAN
> silenciosamente cada delete+insert de assignments [...]
> la publicación automática de las 5:30 PM probablemente nunca escribió
> una sola asignación real en producción.

El fix ya está aplicado (usa `SUPABASE_SERVICE_ROLE_KEY`), pero esto revela un patrón de riesgo.

**Arreglo:** Auditar TODOS los crons en `src/app/api/cron/` para verificar que usan service_role key.

---

# 🟡 MEDIO #7 — `supabase-server.ts` tenía placeholders peligrosos

**Archivo:** `src/lib/supabase-server.ts`, **Línea:** 4-9 (comentario)
> // const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";

El código original usaba placeholders como fallback. Ya fue corregido (ahora lanza error). Verificar que ningún otro archivo tenga este patrón.

---

# 🟡 MEDIO #8 — `pricing.ts` usa `any` en firmas de funciones críticas

**Archivo:** `src/lib/pricing.ts`, **Línea:** 144
> export async function getCurrentHHETable(supabase: any)

**Archivo:** `src/lib/pricing.ts`, **Línea:** 188
> export async function getTargetHourlyRate(supabase: any)

El parámetro `supabase` está tipado como `any`. Esto evade toda verificación de tipos.

**Arreglo:** Usar `SupabaseClient` de `@supabase/supabase-js`.

---

# 🔵 BAJO #5 — Sin Edge Functions

`supabase/functions/` está vacío (0 funciones). Toda la lógica está en Next.js API routes. Esto es válido, pero si se necesita lógica que corra en la BD, las Edge Functions de Supabase serían la herramienta.

---

# 🔵 BAJO #6 — `cra-client.ts` y `service-canada-client.ts` son puramente stubs

Funciones `submitGstReturn()`, `submitT4Return()`, `submitRoe()` no tienen conexión real a los web services de gobierno. Esto es aceptable (requiere registro y certificación), pero debe documentarse explícitamente.

---

# 📊 RESUMEN FINAL CONSOLIDADO (audit + suplemento)

| Categoría | Cantidad | Severidad |
|---|---|---|
| Tablas sin migración | 8 | 🔴 Crítico |
| Sistemas de eventos duplicados | 1 | 🔴 Crítico |
| Catálogos de cuentas incompatibles | 1 | 🔴 Crítico |
| Variables de entorno sin documentar | 25 | 🟠 Alto |
| Módulos financieros sin tests | 7 | 🟠 Alto |
| Stubs/placeholders en servicios externos | 3 | 🟠🟡 |
| Módulos huérfanos/desconectados | 3 | 🔴🟠 |
| `any` types en funciones críticas | 2 | 🟡 |
| Patrón de auth inseguro en crons (corregido, falta auditoría) | 1 | 🟡 |
| TODO markers de proveedores | 6 | 🟡 |

**Total: 23 hallazgos** (4 críticos, 8 altos, 7 medios, 4 bajos)

---

*Suplemento generado el 6 de Agosto, 2026.*
