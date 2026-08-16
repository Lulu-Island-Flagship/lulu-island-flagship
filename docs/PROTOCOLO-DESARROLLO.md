# Protocolo de Desarrollo — Lulu Island Flagship

**v5.0 · Instancia del núcleo genérico**

> Este documento **no es el framework**. Es la instancia del
> [`Manifiesto v5.0`](Manifiesto-v5.0.md) (núcleo genérico) para
> este proyecto. No repite el núcleo: lo materializa para este dominio y este
> stack. Toda regla verificable automáticamente debe estar en CI
> (`.github/workflows/ci.yml`) además de escrita aquí: la regla describe el
> deber, el CI lo garantiza.

---

## 0. Declaración de composición (binding)

```yaml
instance:
  name: "lulu-island-flagship"
  core: "5.0.0"                       # docs/Manifiesto-v5.0.md
  extensions:
    - ext-financial                   # dinero, ledger, impuestos, nómina
    - ext-auth                        # RLS, RBAC, segregación de funciones
    - ext-design                      # tokens, accesibilidad, contraste
  profile: "ts-next-supabase"         # Next.js + TypeScript + Supabase
```

### 0.1 Bounded contexts (mapa carpeta → contexto)

El mapa autoritativo y machine-readable vive en `.governance/bounded-contexts.yaml`.
Aquí, la versión documental:

```yaml
bounded_contexts:
  financial:
    paths: ["src/lib/pricing/**", "src/lib/tax-*", "src/lib/ar-b2b/**",
            "src/lib/ledger*", "src/lib/journal-*", "src/lib/chart-of-accounts*",
            "src/lib/coa*", "src/lib/bank-reconciliation*",
            "src/lib/cash-flow-predictive*", "src/lib/financial-reports*",
            "src/lib/payment-capture-reconciliation*", "src/lib/billing-to-ledger*",
            "src/lib/qbo*", "src/lib/accounting-*", "src/lib/wallet*",
            "src/lib/currency*", "src/lib/money*", "src/lib/installment-payment*",
            "src/lib/stripe*", "src/lib/paypal*", "src/lib/operational-accounting*",
            "src/lib/economic-params*", "src/lib/close-period*", "src/lib/period-guard*",
            "src/lib/shadow-ledger*", "src/lib/ledger-hash*", "src/lib/batch-capture-*"]
  payroll:
    paths: ["src/lib/payroll*/**", "src/lib/payroll*", "src/lib/t4*", "src/lib/t4a*",
            "src/lib/roe*", "src/lib/cra-*", "src/lib/service-canada-client*",
            "src/lib/pay-statement*", "src/lib/statutory-holidays*", "src/lib/sick-leave*",
            "src/lib/employee-financial-dashboard*"]
  identity:
    paths: ["src/lib/admin-*", "src/lib/useAdminRoles*", "src/lib/access-recovery*",
            "src/lib/backup-codes*", "src/lib/crypto*", "src/lib/staff-login*",
            "src/lib/require-*", "src/lib/supabase*"]
  privacy_compliance:
    paths: ["src/lib/pipeda*", "src/lib/pipa-*", "src/lib/compliance-*",
            "src/lib/legal-*", "src/lib/esignature-provider*", "src/lib/photo-retention*"]
  operations:
    paths: ["src/lib/dispatch-*", "src/lib/zone-*", "src/lib/schedule-*",
            "src/lib/weather-*", "src/lib/inventory-*", "src/lib/equipment-*",
            "src/lib/shift-*", "src/lib/kitchen-timer*", "src/lib/campaign-*"]
  communications:
    paths: ["src/lib/sms*", "src/lib/email*", "src/lib/notification-*",
            "src/lib/communication*", "src/lib/telephony-router*", "src/lib/send-communication*"]
  infra:
    paths: ["src/lib/observability*", "src/lib/api-errors*", "src/lib/date-utils*",
            "src/lib/format*", "src/lib/validation*", "src/lib/feature-flags*",
            "src/lib/request-ip*", "src/lib/safe-redirect*", "src/lib/template-engine*",
            "src/lib/export-*", "src/lib/image-compress*"]
```

- **Cota superior:** un cambio que toca varios contextos rige por el más estricto.
- **Sin clasificar:** una ruta fuera del mapa se trata como `UNCLASSIFIED` y
  **bloquea el gate** hasta clasificarse. No hay agujero silencioso.

### 0.2 Perfil de riesgo por contexto (riesgo multidimensional)

```yaml
context_risk:
  financial:          { integrity: CRITICAL, financial_exposure: CRITICAL, reversibility: CRITICAL, privacy: HIGH }
  payroll:            { integrity: CRITICAL, financial_exposure: CRITICAL, privacy: CRITICAL, regulatory: HIGH }
  identity:           { confidentiality: CRITICAL, integrity: HIGH }
  privacy_compliance: { regulatory: CRITICAL, privacy: CRITICAL }
  operations:         { availability: HIGH, integrity: MEDIUM }
  communications:     { privacy: HIGH, confidentiality: MEDIUM }
  infra:              { integrity: MEDIUM, availability: MEDIUM }
```

---

## 1. Principios rectores

1. **Excelencia sin excepciones.** Cero bugs, cero errores, cero warnings.
2. **Seguridad por diseño, no por validación del cliente.** Un cliente
   Supabase malicioso puede eludir cualquier check que solo viva en la API.
3. **Fuente única de verdad.** Ninguna constante o regla de negocio duplicada.
4. **Verificar antes de declarar "hecho".** `tsc` + `lint` + `test` + `build`
   en verde, y revisar en localhost que el cambio tuvo efecto.
5. **Las garantías van en mecanismo** (tipos, tests, CI, RLS, constraints),
   no en comentarios ni promesas.

---

## 2. Base de datos · RLS y autorización (ext-auth)

- **Toda tabla con datos sensibles** (financieros, nómina, contenido, empleados)
  debe tener `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- **Prohibido** `USING (true)` / `WITH CHECK (true)` **sin** cláusula
  `TO service_role`. Sin `TO`, la política aplica a `PUBLIC` (todos los roles).
- **Nunca delegar la autorización a la API.** Si una tabla solo debe editarla
  un admin, la política RLS debe impedir que `authenticated` la toque. La API
  es un camino, no el candado.
- **Escrituras administrativas a tablas protegidas por RLS:**
  1. Validar el rol con `requireAdminRole("recurso")`.
  2. Escribir con `getServiceRoleClient()` (bypasea RLS a propósito).
  - Nunca escribir con el cliente de usuario (`auth.supabase`) sobre una tabla
    cuya política solo permite `service_role`.
- **`SECURITY DEFINER`** siempre con `SET search_path = public` (y `STABLE`
  si es de solo lectura). Evita *search_path hijack*.
- **SQL dinámico** (`EXECUTE format(...)`): solo `%I` (identificadores) y
  `%L`/parámetros (`$1`, `$2`) para valores, con **whitelist** de nombres de
  tabla/columna. Nunca concatenar input de usuario en SQL.

---

## 3. Validación de entrada (límites HTTP)

- Usar **Zod** en los límites de `src/app/api/**` para todo lo que persista datos.
- **Prohibido** `z.any()` + cast para objetos sensibles (nómina, contabilidad,
  impuestos). Validar con el schema real.
- **Invariantes cruzadas** con `.superRefine` / `.refine` en objetos compuestos
  (ej. `total === subtotal + gst + pst`, `saldo_pendiente <= total`).
- **Filtros PostgREST**: nunca interpolar input de usuario en `.or()` /
  `.eq("...")`. Usar whitelist de valores permitidos o parámetros. (Ver
  `escapeLikePattern` en `admin/wallet/search-client` como patrón correcto.)

---

## 4. Dinero exacto (ext-financial activada)

- **Prohibido** `number`/`float`/`double` y `Math.round` para valores
  monetarios en los contextos `financial` y `payroll`. Usar **unidades enteras
  mínimas** (la divisa y su escala definen la unidad).
- Ningún asiento financiero se edita ni borra: solo asiento compensatorio
  tipificado y balanceado.
- Toda mutación monetaria es idempotente (clave + `UNIQUE`).
- El detalle completo del tipo Money, el redondeo y la máquina de estados de
  pago vive en `ext-financial` (referencia: Manifiesto v5.0, Parte 8.1).

> **Estado (v5.0):** el núcleo de dinero ya migró a unidades enteras —
> `src/lib/money.ts` (centavos `bigint`, tasas fiscales como racionales
> enteros) y `src/lib/pricing/taxes.ts` (aritmética fiscal exacta);
> `currency.ts`, `tax-engine.ts` y `ar-b2b/invoice.ts` delegan en él. Los
> wrappers `dollarsToCents`/`centsToDollars` conservan firma `number` como
> límite de display/persistencia. **Deuda restante:** tipado `bigint`
> end-to-end (vs `number`-entero) en los módulos que ya operan en centavos;
> el barrido de aritmética en `float` ya está hecho.

---

## 5. Fuente única de verdad

- **Constantes fiscales** (GST/PST) solo en `src/lib/pricing/taxes.ts`. Los
  demás módulos (`tax-engine`, `coa-imputation`, `compliance-feed`, `ar-b2b`)
  las **importan**, no las re-declaran.
- **Reglas de negocio** viven en `src/lib` como funciones puras; no inline en
  rutas de `src/app/api/**`.
- **No duplicar reglas** (ej. frecuencia de filing CRA). Una sola función
  canónica por regla.
- **Dominios de producción** centralizados (un solo `SITE_URL` canónico);
  no hardcodear dominios distintos en fallbacks.

---

## 6. Testing

- **Todo módulo financiero/fiscal crítico con tests**: AR B2B
  (`ar-b2b/*`, `dunning`, `aging`), `tax-engine`, generadores
  (`t4-generator`, `t4a-generator`, `roe-generator`, `tax-netfile`),
  `financial-reports`, `bank-reconciliation`, `cash-flow-predictive`.
- **Prohibido** `catch {}` vacío sin log ni señal. Si se traga un fallo,
  documentar por qué y dejar un `console.error`/`captureError`.
- Los tests usan `node:assert` y fakes de frontera I/O; no mockear lógica
  interna.
- **Idempotencia** (ext-financial): los endpoints de mutación financiera se
  prueban con *double-execution replay* (misma `Idempotency-Key` dos veces:
  el ledger no duplica filas y la respuesta es idéntica).

---

## 7. Resiliencia · I/O externa

- **Toda llamada externa** (Twilio, Resend, PayPal, BC Assessment, Nominatim,
  Google Places, OpenWeatherMap, Stripe) con **timeout explícito**
  (`AbortSignal.timeout(...)`). Nunca una llamada sin límite de tiempo en el
  camino crítico de cotización/reserva/cobro.
- **Nunca devolver `err.message` crudo al cliente.** Usar `safeErrorResponse`
  (`src/lib/api-errors.ts`). El detalle interno (tablas/columnas/RPC) va al
  log del servidor, no a la respuesta.
- **Enmascarar PII antes de loguear**: `maskPhoneNumber` (`src/lib/sms.ts`),
  `maskEmail` (`src/lib/email.ts`). Nunca loguear email/teléfono/bancario/SIN
  en claro.
- **Logging estructurado** JSON con `{ timestamp, level, event, ...data }`
  (`src/lib/observability.ts`).

---

## 8. CI / Deploy (mecanismo)

- **CI bloquea merge** si falla cualquiera de: typecheck, lint, build, tests,
  `npm audit --audit-level=critical`, y las invariantes grep (tokens de diseño,
  contraste, privacidad, a11y).
- **Prohibido** en CI y en código: `|| true`, `continue-on-error: true`,
  `ignoreBuildErrors`, `ignoreDuringBuilds`, `--no-lint`, `// eslint-disable`,
  `// @ts-ignore`. Si un check es ruidoso, ajustar el umbral de la regla — no
  deshabilitar el check.
- **Migraciones**: numeración secuencial sin colisiones (un solo archivo por
  número). Al renombrar/renumerar, actualizar cualquier referencia.
- **Secretos**: nunca en claro, nunca en logs/commits/terminal. `.env*` solo
  con placeholders. Nunca imprimir un secret generado en la terminal.
- **Waivers** (válvula de escape del núcleo, Parte 5): cualquier excepción a
  una regla se registra en `.governance/waivers/*.yaml` con `rule_id`, motivo,
  control compensatorio y `expires_at`. El CI rompe el build si un waiver
  expira. Un waiver **nunca** aplica a una regla de Nivel 1.

---

## 9. Verificación antes de "hecho" / "live"

Correr siempre, en este orden, y con **cero** errores:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Y el **checklist pre-live** (GitHub sincronizado · Vercel deploy ✅ ·
Supabase migraciones aplicadas · build limpio · localhost smoke-test). No
declarar "live" hasta confirmar las 5 plataformas.

---

## 10. Reglas de comunicación (agentes)

1. Nunca quedarse en silencio al terminar un objetivo o milestone.
2. Avisar cuando un sub-agente termina (qué hizo y si tuvo éxito).
3. Verificar antes de declarar "hecho".
4. No hacer push/deploy sin confirmación explícita del usuario.
5. No rotar secrets sin autorización explícita.

---

## Estado de adopción (gap núcleo → instancia)

Materializado en la migración v5.0 (2026-08-15):

- [x] Migrar `src/lib/pricing/taxes.ts` de `number` a unidades enteras (`[INTEGRITY_FIX]`) — `src/lib/money.ts` + `taxes.ts`.
- [x] Crear `docs/LEARNINGS.md` (núcleo, Parte 6.3) y enlazar incidentes.
- [x] Crear `.governance/bounded-contexts.yaml` (mapa machine-readable).
- [x] Crear `.governance/waivers/` (válvula de escape, núcleo Parte 5).
- [x] Empaquetar los checks de CI en un comando local `verify:invariants`, ahora con gates de: tokens/contraste/privacidad, waivers (expiración + máx. 5 + antigüedad 30 d + aprobador 40-hex), `UNCLASSIFIED` diff-aware con cota superior de riesgo por contexto, y niveles de evidencia mínimos.

Seguimiento pendiente (no bloquea):

- [ ] Evidencia E3 real (integración) para las reglas marcadas `PARTIAL` en
  `.governance/rules.yaml`.
- [ ] Tipado `bigint` end-to-end (vs `number`-entero) en los módulos que ya
  operan en centavos.
- [ ] El hábito de clasificar archivos nuevos en
  `.governance/bounded-contexts.yaml` (evitar que caigan por omisión en
  `src/lib/**` → `infra`).

---

*Documento mantenido por el equipo. Si encuentras una regla incumplida, es un
bug del código o del proceso: arréglalo o repórtalo, no lo silencies.*
