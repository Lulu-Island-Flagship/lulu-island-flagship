# profile-ts-next-supabase — Binding de mecanismos a Next.js + TypeScript + Supabase

```yaml
profile:
  id: "ts-next-supabase"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  binds:
    - { mechanism: "tipo_entero_escala_minima", technology: "bigint de TypeScript" }
    - { mechanism: "validacion_declarativa", technology: "Zod" }
    - { mechanism: "autorizacion_por_filas", technology: "políticas RLS de Supabase" }
    - { mechanism: "idempotencia", technology: "UNIQUE + middleware de Idempotency-Key" }
    - { mechanism: "timeout_explicito", technology: "AbortSignal.timeout(...)" }
```

> **Aquí —y solo aquí—** aparecen TypeScript, Zod, `npx tsc`, npm y Supabase.
> El núcleo no los conoce (Manifiesto v5.0, Parte 8.4). Un cambio de stack se
> hace aquí sin tocar el núcleo ni las extensiones.

| Mecanismo | Tecnología | Evidencia |
|---|---|---|
| `tipo_entero_escala_minima` (dinero exacto) | `bigint` de TypeScript para centavos; prohibido `number` para dinero en `financial`/`payroll`. | E1 `npx tsc --noEmit` (typecheck) + grep invariante; E2 `tests/lib/money.test.ts`. |
| `validacion_declarativa` | **Zod** en `src/app/api/**`; el input se valida con schema antes de usarse; nunca interpolar input en filtros PostgREST. | E1 typecheck; E2 tests de schema (entrada inválida rechazada). |
| `autorizacion_por_filas` (RLS) | **Políticas RLS de Supabase** con `TO <rol>` explícito; prohibido `USING (true)` sin `TO service_role`. | E3 probes RLS (`anon`/`authenticated`/`service_role`). |
| `idempotencia` | **`UNIQUE (idempotency_key, scope)` + middleware** que exige `Idempotency-Key` en mutaciones monetarias. | E2/E3 double-execution replay: mismo key dos veces → sin duplicados y respuesta idéntica. |
| `timeout_explicito` (I/O externa) | **`AbortSignal.timeout(...)`** en toda llamada externa (Twilio, Resend, PayPal, Stripe, …); nunca una llamada sin límite. | E1 grep (no `fetch` desnudo en camino crítico); E2 test de timeout (la llamada aborta al vencer el plazo). |

## Notas de binding

- **`bigint` no aritmetiza con `number`:** el dinero entra/sale de la capa de
  datos como entero; los wrappers `number` solo existen en el límite de
  display/persistencia y jamás participan en aritmética monetaria.
- **Zod es la frontera de validación:** una vez parseado, el tipo es el schema;
  no se re-verifica a mano río abajo.
- **RLS es defensa, no adorno:** la API también comprueba roles
  (`requireRole`), pero la política RLS debe impedir el acceso directo aunque
  la API se salte el check.
- **Idempotencia = constraint + middleware:** el `UNIQUE` garantiza la
  invariancia incluso si el middleware falla; el middleware aporta la
  `Idempotency-Key` y el replay idéntico.
- **Timeouts explícitos:** `AbortSignal.timeout(ms)` en el camino crítico de
  cotización/reserva/cobro; la señal aborta la operación y se devuelve
  `safeErrorResponse`, nunca `err.message` crudo.
