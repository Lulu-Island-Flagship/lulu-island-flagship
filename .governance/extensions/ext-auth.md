# ext-auth — RBAC/RLS, segregación de funciones y break-glass (extensión de dominio)

```yaml
extension:
  id: "ext-auth"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  provides_capabilities:
    - "RBAC"
    - "RLS"
    - "SegregacionDeFunciones"
    - "AutorizacionPorOperacion"
    - "BreakGlass"
```

> **Alcance:** todo acceso a datos y toda operación privilegiada
> (`identity`/`financial`/`payroll` y cualquier mutación crítica). La columna
> «Tecnología» es de dominio; el binding concreto (`políticas RLS de Supabase`,
> etc.) vive en `profile-ts-next-supabase.md`. Cada fila es una regla de
> primera clase (Manifiesto v5.0, Parte 2).

| ID | Garantía | Mecanismo | Tecnología | Evidencia |
|---|---|---|---|---|
| `EXT-AUTH-001` | **Segregación de funciones:** `CREATOR ≠ APPROVER ≠ RECONCILER`; una misma identidad no puede ocupar dos de esos roles sobre el mismo objeto/flujo. | Roles separados + check que impide solapar roles en un mismo asiento/operación. | RBAC con roles (`creator`/`approver`/`reconciler`) y guard de no-solapamiento. | E2 test de roles (solapamiento rechazado); E1 type/assert. |
| `EXT-AUTH-002` | **RLS por defecto-deny:** solo `service_role` (u otro rol explícito) puede leer/escribir tablas protegidas; prohibido `USING (true)` sin `TO`. | Política RLS con `TO <rol>` explícito; sin cláusula `TO` se considera `PUBLIC` (bug). | Políticas RLS de la base de datos (Supabase vía perfil). | E3 probes RLS: `anon`/`authenticated` no leen/escriben; `service_role` sí. |
| `EXT-AUTH-003` | **Autorización en cada operación privilegiada:** ningún endpoint delega la autorización solo a la API; la base de datos también la impone. | Check de autorización en el handler (`requireRole`) **y** RLS en la base; doble control. | Guard de rol en API + política RLS en BD. | E2/E3: cliente malicioso sin rol es rechazado por RLS aunque llame directo a la BD. |
| `EXT-AUTH-004` | **Break-glass** como conducto auditable, no como excepción: activación M/N, asiento inmutable, TTL 24 h, alerta P0, incident-to-test. | Protocolo Parte 5.4 materializado en `.governance/break-glass/` (log append-only + gate). | `log.yaml` append-only + gate `verify:invariants`. | E5 drill (`docs/break-glass-drill.md`, 2026-08-15); E3 gate rechaza activaciones vencidas/coherentes. |

## Reglas de primer clase (Parte 2)

```yaml
rules:
  - { id: "EXT-AUTH-001", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-AUTH-002", property_protected: "confidentiality", evidence_level: "E3", exceptions: { allowed: false } }
  - { id: "EXT-AUTH-003", property_protected: "integrity", evidence_level: "E3", exceptions: { allowed: false } }
  - { id: "EXT-AUTH-004", property_protected: "availability", evidence_level: "E5", exceptions: { allowed: true, waiver_path: "ninguno — solo break-glass (Parte 5.4)" } }
```

> `EXT-AUTH-001..003` derivan de invariantes de Nivel 1
> (`exceptions.allowed: false`). `EXT-AUTH-004` es la **válvula de escape**
> regulada: no se "waivea", se **activa** con asiento inmutable, TTL y
> revocación automática (nunca sobre reglas de Nivel 1).
