# AGENTS.md — Reglas para agentes de IA

> Protocolo obligatorio para cualquier agente (Codewhale, Claude Code, Cursor,
> Antigravity, etc.) que trabaje en este repositorio. El documento completo y
> detallado está en [`docs/PROTOCOLO-DESARROLLO.md`](docs/PROTOCOLO-DESARROLLO.md).
> Léelo antes de escribir código. Estas son las reglas no negociables.

## No negociable

1. **Verifica antes de declarar "hecho".** Corre `npx tsc --noEmit`,
   `npm run lint`, `npm test` y `npm run build` — cero errores. Revisa en
   localhost que el cambio tuvo efecto.
2. **Nunca escondas errores.** Prohibido `|| true`, `continue-on-error: true`,
   `@ts-ignore`, `// eslint-disable`, `ignoreBuildErrors`, `--no-lint`.
   Arregla la causa raíz.
3. **Nunca hagas push/deploy sin confirmación explícita del usuario.**
4. **Nunca rotes ni imprimas secrets.** Un secret generado jamás se escribe en
   la terminal, logs, commits o `.env` real.
5. **Nunca te quedes en silencio al terminar.** Anuncia siempre el resultado.

## Seguridad (base de datos)

- RLS en toda tabla sensible. **Nunca** `USING (true)`/`WITH CHECK (true)` sin
  `TO service_role`.
- **Nunca** delegues la autorización a la API; el candado vive en RLS.
- Escrituras admin sobre tablas RLS: `requireAdminRole(...)` → luego
  `getServiceRoleClient()` (nunca `auth.supabase` para eso).
- `SECURITY DEFINER` siempre con `SET search_path = public` (+ `STABLE` si es
  de solo lectura).
- SQL dinámico: `%I`/`%L` + whitelist; nunca concatenar input de usuario.
- Filtros PostgREST: whitelist o parámetros; nunca interpolar input en `.or()`.

## Validación

- Zod en los límites de `src/app/api/**`. Prohibido `z.any()` + cast para
  objetos sensibles (nómina, contabilidad). Invariantes cruzadas con
  `.superRefine`.

## Fuente única de verdad

- GST/PST solo en `src/lib/pricing/taxes.ts`; los demás módulos **importan**.
- Lógica de negocio en `src/lib` (funciones puras), no inline en rutas.
- Un solo dominio de producción canónico; no hardcodear dominios distintos.

## Testing

- Todo módulo financiero/fiscal crítico con tests (`ar-b2b`, `tax-engine`,
  `t4/t4a/roe/netfile`, `financial-reports`, `bank-reconciliation`,
  `cash-flow-predictive`).
- Prohibido `catch {}` vacío sin log.

## Resiliencia

- Toda I/O externa (Twilio, Resend, PayPal, Stripe, geocoding, weather) con
  `AbortSignal.timeout(...)`.
- Nunca devolver `err.message` crudo al cliente → `safeErrorResponse`.
- Enmascarar PII antes de loguear (`maskPhoneNumber`, `maskEmail`).

## Migraciones

- Numeración secuencial, sin colisiones (un archivo por número).
- Cada tabla nueva con RLS y políticas explícitas.
