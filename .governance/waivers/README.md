# Waivers — válvula de escape del núcleo v5.0

Directorio para registrar excepciones a reglas del Manifiesto v5.0
(núcleo, Parte 5). Cada waiver vive en un archivo `.governance/waivers/*.yaml`.
Este README documenta el schema; **no** crea ningún archivo `.yaml` real de
waiver para no activar el gate de CI.

## Reglas fundamentales

- Un waiver **nunca** aplica a una regla derivada de un invariante de **Nivel 1**
  (reglas con `exceptions.allowed: false` no tienen camino de excepción).
- El CI **rompe la build** si `now() > expires_at`. Un waiver vencido es un
  error de build, no un aviso.
- Un waiver es temporal: `expires_at` en formato `YYYY-MM-DD`.
- Un waiver no silencia la regla: documenta el motivo y exige un
  `compensating_control` que reduzca el riesgo aceptado.
- La "aprobación" no es texto libre (núcleo §5.3): `approver` debe referenciar
  un **commit firmado** de un actor con rol verificado.

## Schema (núcleo §5.1 — campos obligatorios)

Convención de nombre de archivo: `.governance/waivers/<rule_id>_<fecha>.yaml`.

```yaml
waiver:
  rule_id: ""              # string   — ID de la regla eximida (ej. "CORE-INTEGRITY-001")
  scope: ""                # string   — alcance acotado de la excepción (módulo/ruta)
  reason: ""               # string   — motivo por el que se acepta temporalmente
  compensating_control: "" # string   — control que mitiga el riesgo aceptado
  expires_at: ""           # YYYY-MM-DD — vencimiento; al pasar, el CI rompe la build
  approver: ""             # string   — firma de commit del aprobador (rol verificado)
```

| Campo                  | Tipo / formato | Descripción                                                                 |
| ---------------------- | -------------- | --------------------------------------------------------------------------- |
| `rule_id`              | string         | Identificador de la regla que se exime.                                     |
| `scope`                | string         | Módulo/ruta y motivo acotado de la excepción.                               |
| `reason`               | string         | Motivo por el que se acepta la excepción.                                   |
| `compensating_control` | string         | Control compensatorio que mitiga el riesgo aceptado.                        |
| `expires_at`           | `YYYY-MM-DD`   | Fecha de vencimiento. Al pasar, el CI rompe la build.                       |
| `approver`             | string         | Firma de commit del aprobador (rol verificado), no texto libre.             |

## Ejemplo comentado (no crear este archivo)

```yaml
# .governance/waivers/ejemplo.yaml — SOLO de referencia, NO crear.
# waiver:
#   rule_id: "EXT-FIN-001"                    # regla de Nivel 2+ (NUNCA Nivel 1)
#   scope: "src/lib/pricing/taxes.ts"         # alcance acotado de la excepción
#   reason: >                                # motivo (deuda conocida, plan de migración)
#     Deuda conocida [INTEGRITY_FIX]: aún usa number + Math.round.
#     Migración a unidades enteras planificada.
#   compensating_control: >                  # qué mitiga el riesgo mientras tanto
#     Tests de invariantes monetarias y revisión manual del path de impuestos.
#   expires_at: "2025-12-31"                  # fecha límite (YYYY-MM-DD)
#   approver: "<hash de commit firmado>"      # firma de commit del aprobador
```
