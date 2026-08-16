# AGENTS.md — Reglas para agentes de IA (v5.0)

> Protocolo obligatorio para cualquier agente (Codewhale, Claude Code, Cursor,
> Antigravity, etc.) que trabaje en este repositorio. El documento completo y
> detallado es [`docs/PROTOCOLO-DESARROLLO.md`](docs/PROTOCOLO-DESARROLLO.md)
> (la instancia v5.0 de este proyecto); el núcleo genérico es el
> **Manifiesto de Gobernanza v5.0**, referenciado allí. Léelos antes de
> escribir código. Estas son las reglas no negociables.

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

Verificación local de invariantes: `npm run verify:invariants`.

## Modelo de gobernanza (v5.0)

- **Capa cuaternaria:** toda exigencia se expresa como **garantía** (qué debe
  ser verdad) → **mecanismo** (cómo se hace cumplir) → **tecnología** (con qué
  se implementa) → **evidencia** (cómo se demuestra). Las garantías viven en
  mecanismo, no en prosa ni comentarios.
- **Bounded contexts:** cada ruta del repo pertenece a un contexto; el mapa
  autoritativo vive en `.governance/bounded-contexts.yaml`.
- **Riesgo multidimensional:** el perfil por dimensiones (integridad,
  privacidad, exposición financiera, …) rige con **cota superior**: un cambio
  que toca varios contextos se rige por el más estricto. Una ruta fuera del
  mapa (`UNCLASSIFIED`) bloquea el gate hasta clasificarse.
- **Evidencia (E0–E5):** declaración, análisis estático, test automatizado,
  integración real, verificación independiente y evidencia operacional. Cada
  garantía exige su nivel mínimo.
- **Waivers:** toda excepción se registra en `.governance/waivers/*.yaml`
  (`rule_id`, motivo, control compensatorio, `expires_at`, aprobador); el CI
  rompe el build si expira. Un waiver **nunca** aplica a una regla de Nivel 1.
- **Bootstrap y cierre:** al iniciar una sesión, lee `docs/LEARNINGS.md` y el
  último `MANIFEST_AUDIT`. Al cerrar cada tarea, emite tu bloque
  `MANIFEST_AUDIT` (garantía → mecanismo → prueba → estado:
  `VERIFIED`/`UNVERIFIED`/`BLOCKED`/`WAIVED`).

## Seguridad (base de datos)

- RLS en toda tabla sensible. **Nunca** `USING (true)`/`WITH CHECK (true)` sin
  `TO service_role`.
- **Nunca** delegues la autorización a la API; la garantía vive en el
  mecanismo RLS (el candado) y la API es solo un camino.
- Escrituras admin sobre tablas RLS: `requireAdminRole(...)` → luego
  `getServiceRoleClient()` (nunca `auth.supabase` para eso).
- `SECURITY DEFINER` siempre con `SET search_path = public` (+ `STABLE` si es
  de solo lectura).
- SQL dinámico: `%I`/`%L` + whitelist; nunca concatenar input de usuario.
- Filtros PostgREST: whitelist o parámetros; nunca interpolar input en `.or()`.

## Validación

- Zod en los límites de `src/app/api/**` — el mecanismo que materializa la
  garantía de integridad en los límites HTTP. Prohibido `z.any()` + cast para
  objetos sensibles (nómina, contabilidad). Invariantes cruzadas con
  `.superRefine`.

## Fuente única de verdad

- GST/PST solo en `src/lib/pricing/taxes.ts`; los demás módulos **importan**.
- Lógica de negocio en `src/lib` (funciones puras), no inline en rutas.
- Un solo dominio de producción canónico; no hardcodear dominios distintos.

## Testing

- Todo módulo financiero/fiscal crítico con tests (`ar-b2b`, `tax-engine`,
  `t4/t4a/roe/netfile`, `financial-reports`, `bank-reconciliation`,
  `cash-flow-predictive`): los tests son la evidencia mínima de esas
  garantías.
- Prohibido `catch {}` vacío sin log.

## Resiliencia

- Toda I/O externa (Twilio, Resend, PayPal, Stripe, geocoding, weather) con
  `AbortSignal.timeout(...)`.
- Nunca devolver `err.message` crudo al cliente → `safeErrorResponse`.
- Enmascarar PII antes de loguear (`maskPhoneNumber`, `maskEmail`).

## Migraciones

- Numeración secuencial, sin colisiones (un archivo por número).
- Cada tabla nueva con RLS y políticas explícitas.
