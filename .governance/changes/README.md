# `.governance/changes/` — Objetos CHANGE (Manifiesto v5.0, Parte 6.2)

Un **CHANGE** documenta y autoriza un cambio que toca un **contexto protegido**:
aquellos con al menos una dimensión `CRITICAL` en
`.governance/bounded-contexts.yaml` (`financial`, `payroll`, `identity`,
`privacy_compliance`, `db`).

El gate `verify:invariants` exige **al menos un objeto CHANGE válido** en este
directorio cuando el diff toca uno de esos contextos. Si el diff no toca ningún
contexto protegido, el gate pasa sin exigir CHANGE.

## Schema mínimo (obligatorio)

Cada archivo `*.yaml` de este directorio es un objeto CHANGE. Puede escribirse
directamente o envuelto bajo la clave `change:` (ambas formas se aceptan):

```yaml
change:
  id: "CHG-<fecha>-<secuencia>"            # string no vacío
  intent: "..."                            # string no vacío
  invariants_affected: ["INST-FIN-001"]    # array no vacío de strings
  verification_plan: ["unit", "integration", "property"]  # array no vacío de strings
```

Campos validados por el gate:

| Campo | Tipo | Regla |
| --- | --- | --- |
| `id` | string | no vacío |
| `intent` | string | no vacío |
| `invariants_affected` | string[] | array no vacío de strings |
| `verification_plan` | string[] | array no vacío de strings |

## Campos opcionales (documentación; el gate no los valida)

```yaml
  scope: { contexts: ["financial"], modules: ["billing"] }
  risk_profile: { ... }            # multidimensional, calculado del diff
  decisions_required: ["política_de_redondeo"]
  rollback_plan: "..."
  evidence: { status: "PENDING" }
```

## Reglas

- Un archivo `*.template.yaml` / `*.example.yaml`, o un archivo vacío (solo
  comentarios), se ignora.
- Con un contexto protegido tocado, un objeto CHANGE con schema inválido se
  reporta como violación bloqueante.
- El gate valida el **schema mínimo**; la coherencia semántica entre
  `invariants_affected` y el riesgo declarado queda como responsabilidad del
  revisor.
