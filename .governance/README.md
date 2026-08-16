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

1. **Parse y schema.** Carga cada YAML (rules, bounded-contexts, waivers, log
   break-glass) y valida contra el schema correspondiente.
2. **Consistencia de evidencia.** Para cada regla con `evidence_status:
   VERIFIED` exige evidencia real (E3/E2 según `evidence_level`); una regla
   solo puede bajar de VERIFIED a PARTIAL a través de un waiver.
3. **Waivers.** Verifica schema, expiración y umbrales; rechaza cualquier
   waiver sobre una regla con `exceptions_allowed: false` (Nivel 1).
4. **Break-glass.** Verifica que `log.yaml` siga siendo append-only, que ningún
   asiento exceda `ttl_horas: 24`, y que las activaciones vencidas estén
   revocadas.
5. **Changes.** Exige que un cambio que toque un contexto protegido lleve su
   objeto CHANGE con `invariants_affected` y un `verification_plan` coherente
   con el riesgo declarado.

El resultado del gate es bloqueante: un fallo impide que el cambio se integre.
