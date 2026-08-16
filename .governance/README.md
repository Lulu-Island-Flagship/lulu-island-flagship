# `.governance` — Árbol de gobernanza (Manifiesto v5.0)

Índice de las piezas normativas de la instancia. Cada pieza es un objeto de
primera clase con identidad, propiedad protegida, riesgo, mecanismo y evidencia
exigida. El gate **`verify:invariants`** las hace cumplir: valida la sintaxis y
el esquema de cada YAML, valida la existencia física de los artefactos declarados,
y rechaza cambios que violen los invariantes constitucionales.

| Pieza | Contenido | Manifiesto v5.0 |
| --- | --- | --- |
| `bounded-contexts.yaml` | Mapa de contextos acotados (financial, payroll, …), sus fronteras, ownership e invariantes por contexto | Parte 2.2 / 3.4 |
| `rules.yaml` | Registro de reglas normativas (`INST-*`): statement, propiedad protegida, riesgo multidimensional, mecanismo, `evidence_level` (mínimo exigido) y `evidence_status` (VERIFIED/PARTIAL) | Parte 2 |
| `waivers/` | Excepciones tipadas con schema, alcance y expiración; nunca aplican a reglas de Nivel 1 (`exceptions_allowed: false`) | Parte 5.1 / 5.2 |
| `break-glass/` | Protocolo de emergencia: `README.md` (procedimiento), `break-glass-template.yaml` (template de activación) y `log.yaml` (log INMUTABLE append-only) | Parte 5.4 |
| `change-template.yaml` | Objeto CHANGE: intent, scope, risk_profile multidimensional, decisiones, invariantes afectados, plan de verificación, rollback y evidencia | Parte 6.2 |

## Cómo lo hace cumplir el gate `verify:invariants`

El gate ejecuta 11 invariantes y sale con código 1 si alguna viola. Todas son
bloqueantes:

1. **Tokens de diseño.** Cero hex de marca fuera de `src/design/tokens.ts` y
   `src/app/tokens.css`.
2. **Contraste.** `text-brand-gold` nunca se usa como texto/icono; debe usarse
   `text-brand-gold-dark`.
3. **Privacidad.** Sin `select("*")` sobre `quotes`/`orders` en páginas de
   cliente (`src/app/[locale]/`).
4. **Waivers.** `expires_at` en el futuro, máximo 5 activos, antigüedad ≤ 30
   días y `approver` como commit firmado (40 hex).
5. **UNCLASSIFIED.** Cada archivo del diff debe clasificar en un bounded
   context de `.governance/bounded-contexts.yaml`; calcula y muestra la cota
   superior de riesgo.
6. **Evidencia mínima y artefactos reales.** Toda regla con una dimensión CRITICAL
   en `.governance/rules.yaml` exige declarar `evidence_level ≥ E3`. Se verifica
   la existencia física en disco de los artefactos declarados en `mechanism`.
7. **Migraciones.** Numeración secuencial sin colisiones en
   `supabase/migrations/`.
8. **RLS en migraciones nuevas (INST-GOV-002).** Chequeo diff-aware: una
   migración añadida/modificada con `CREATE TABLE` debe habilitar
   `ENABLE ROW LEVEL SECURITY` para esa tabla en el mismo archivo.
9. **Break-glass (TTL real y fechas).** Valida el schema de
   `.governance/break-glass/log.yaml`, `ttl_horas ≤ 24`, `activacion_id` único/inmutable,
   coherencia temporal del TTL derivado (`expira_en == activado_en + ttl_horas`),
   y que toda activación vencida esté marcada como revocada (`REVOCADO`/`REVOCADA`/`revocado_en`).
10. **CHANGE (cobertura semántica).** Si el diff toca un contexto protegido
    (CRITICAL: `financial`, `identity`), exige un objeto CHANGE válido en
    `.governance/changes/*.yaml` cuyo `scope.contexts` cubra todos los contextos
    protegidos modificados en el diff.
11. **LEARNINGS (bidireccionalidad Parte 6.4).** Escanea todo el repositorio
    buscando referencias `@incident LEARNING-XXX` y verifica que cada una esté
    formalmente registrada y documentada en `docs/LEARNINGS.md`.

El resultado del gate es bloqueante: un fallo impide que el cambio se integre.
