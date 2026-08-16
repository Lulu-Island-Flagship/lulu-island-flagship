# `.governance` — Árbol de gobernanza (Manifiesto v5.0)

Índice de las piezas normativas de la instancia. Cada pieza es un objeto de
primera clase con identidad, propiedad protegida, riesgo, mecanismo y evidencia
exigida. El gate **`verify:invariants`** las hace cumplir: valida la sintaxis y
el esquema de cada YAML, compara `evidence_status` declarado contra la
evidencia real, y rechaza cambios que degraden un estado `VERIFIED` sin un
waiver registrado y vigente.

| Pieza | Contenido | Manifiesto v5.0 |
| --- | --- | --- |
| `bounded-contexts.yaml` | Mapa de contextos acotados (financial, payroll, …), sus fronteras, ownership e invariantes por contexto | Parte 2.2 / 3.4 |
| `rules.yaml` | Registro de reglas normativas (`INST-*`): statement, propiedad protegida, riesgo multidimensional, mecanismo, `evidence_level` (mínimo exigido) y `evidence_status` (VERIFIED/PARTIAL) | Parte 2 |
| `waivers/` | Excepciones tipadas con schema, alcance y expiración; nunca aplican a reglas de Nivel 1 (`exceptions_allowed: false`) | Parte 5.1 / 5.2 |
| `break-glass/` | Protocolo de emergencia: `README.md` (procedimiento), `break-glass-template.yaml` (template de activación) y `log.yaml` (log INMUTABLE append-only) | Parte 5.4 |
| `change-template.yaml` | Objeto CHANGE: intent, scope, risk_profile multidimensional, decisiones, invariantes afectados, plan de verificación, rollback y evidencia | Parte 6.2 |

## Cómo lo hace cumplir el gate `verify:invariants`

El gate ejecuta 10 invariantes y sale con código 1 si alguna viola. Todas son
bloqueantes salvo nota explícita:

1. **Tokens de diseño.** Cero hex de marca fuera de `src/design/tokens.ts` y
   `src/app/tokens.css`.
2. **Contraste.** `text-brand-gold` nunca se usa como texto/icono; debe usarse
   `text-brand-gold-dark`.
3. **Privacidad.** Sin `select("*")` sobre `quotes`/`orders` en páginas de
   cliente (`src/app/[locale]/`).
4. **Waivers.** `expires_at` en el futuro, máximo 5 activos, antigüedad ≤ 30
   días y `approver` como commit firmado (40 hex).
5. **UNCLASSIFIED.** Cada archivo del diff debe clasificar en un bounded
   context de `.governance/bounded-contexts.yaml`; imprime la cota superior de
   riesgo.
6. **Evidencia mínima.** Toda regla con una dimensión CRITICAL en
   `.governance/rules.yaml` declara `evidence_level ≥ E3`.
7. **Migraciones.** Numeración secuencial sin colisiones en
   `supabase/migrations/`.
8. **RLS en migraciones nuevas (INST-GOV-002).** Chequeo diff-aware: una
   migración añadida/modificada con `CREATE TABLE` debe habilitar
   `ENABLE ROW LEVEL SECURITY` para esa tabla en el mismo archivo. Las
   migraciones legacy no se escanean.
9. **Break-glass.** Valida el schema de `.governance/break-glass/log.yaml`,
   `ttl_horas ≤ 24`, `activacion_id` único/inmutable, y que toda activación
   vencida esté marcada como revocada.
10. **CHANGE.** Si el diff toca un contexto protegido (CRITICAL en
    `.governance/bounded-contexts.yaml`: `financial`, `payroll`, `identity`,
    `privacy_compliance`, `db`), exige un objeto CHANGE válido en
    `.governance/changes/*.yaml` (`id`, `intent`, `invariants_affected[]`,
    `verification_plan[]`).

El resultado del gate es bloqueante: un fallo impide que el cambio se integre.
