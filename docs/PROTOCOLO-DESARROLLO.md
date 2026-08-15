# Protocolo de Desarrollo — Lulu Island Flagship

> **MANIFEST v4.2** · Fuente canónica de las reglas técnicas del proyecto.
> Todo código nuevo debe cumplir este documento. Cuando una regla sea
> verificable automáticamente, debe estar en CI (`.github/workflows/ci.yml`)
> además de estar escrita aquí: la regla escrita describe el deber, el CI lo
> garantiza.

---

## 0. Principios rectores

1. **Excelencia sin excepciones.** Cero bugs, cero errores, cero warnings.
2. **Seguridad por diseño, no por validación del cliente.** Un cliente
   Supabase malicioso puede eludir cualquier check que solo viva en la API.
3. **Fuente única de verdad.** Ninguna constante o regla de negocio duplicada.
4. **Verificar antes de declarar "hecho".** `tsc` + `lint` + `test` + `build`
   en verde, y revisar en localhost que el cambio tuvo efecto.
5. **Las garantías van en mecanismo** (tipos, tests, CI, RLS, constraints),
   no en comentarios ni promesas.

---

## 1. Base de datos · RLS y autorización

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

## 2. Validación de entrada (límites HTTP)

- Usar **Zod** en los límites de `src/app/api/**` para todo lo que persista datos.
- **Prohibido** `z.any()` + cast para objetos sensibles (nómina, contabilidad,
  impuestos). Validar con el schema real.
- **Invariantes cruzadas** con `.superRefine` / `.refine` en objetos compuestos
  (ej. `total === subtotal + gst + pst`, `saldo_pendiente <= total`).
- **Filtros PostgREST**: nunca interpolar input de usuario en `.or()` /
  `.eq("...")`. Usar whitelist de valores permitidos o parámetros. (Ver
  `escapeLikePattern` en `admin/wallet/search-client` como patrón correcto.)

---

## 3. Fuente única de verdad

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

## 4. Testing

- **Todo módulo financiero/fiscal crítico con tests**: AR B2B
  (`ar-b2b/*`, `dunning`, `aging`), `tax-engine`, generadores
  (`t4-generator`, `t4a-generator`, `roe-generator`, `tax-netfile`),
  `financial-reports`, `bank-reconciliation`, `cash-flow-predictive`.
- **Prohibido** `catch {}` vacío sin log ni señal. Si se traga un fallo,
  documentar por qué y dejar un `console.error`/`captureError`.
- Los tests usan `node:assert` y fakes de frontera I/O; no mockear lógica
  interna.

---

## 5. Resiliencia · I/O externa

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

## 6. CI / Deploy (mecanismo)

- **CI bloquea merge** si falla cualquiera de: typecheck, lint, build, tests,
  `npm audit --audit-level=critical`, y las invariantes grep (tokens de diseño,
  contraste, privacidad, a11y).
- **Prohibido** en CI y en código: `|| true`, `continue-on-error: true`,
  `ignoreBuildErrors`, `ignoreDuringBuilds`, `--no-lint`, `// eslint-disable`,
  `// @ts-ignore`. Si un check es ruidoso, ajustar el umbral de la regla — no
  deshabilitar el check.
- **Migraciones**: numeración secuencial sin colisiones (un solo archivo por
  número). Al renombrar/renumerar, actualizar cualquier referencia.
- **Secretos**: nunca en el código ni en logs ni en commits. En
  `supabase/config.toml` usar `env(...)`. `.env*` solo con placeholders.
  Nunca imprimir un secret generado en la terminal.

---

## 7. Verificación antes de "hecho" / "live"

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

## 8. Reglas de comunicación (agentes)

1. Nunca quedarse en silencio al terminar un objetivo o milestone.
2. Avisar cuando un sub-agente termina (qué hizo y si tuvo éxito).
3. Verificar antes de declarar "hecho".
4. No hacer push/deploy sin confirmación explícita del usuario.
5. No rotar secrets sin autorización explícita.

---

*Documento mantenido por el equipo. Si encuentras una regla incumplida, es un
bug del código o del proceso: arréglalo o repórtalo, no lo silencies.*
