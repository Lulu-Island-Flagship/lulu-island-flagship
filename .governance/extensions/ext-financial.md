# ext-financial — Dinero, ledger, impuestos y pagos (extensión de dominio)

```yaml
extension:
  id: "ext-financial"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  provides_capabilities:
    - "DineroExacto"
    - "RedondeoMedioArriba"
    - "TasasRacionales"
    - "IdempotenciaMonetaria"
    - "LedgerAppendOnly"
    - "PartidaDoble"
    - "Reconciliacion"
    - "ReglasFiscalesVersionadas"
    - "MaquinaEstadosPago"
```

> **Alcance:** bounded contexts `financial` y `payroll` (véase
> `.governance/bounded-contexts.yaml`). La columna «Tecnología» es **dominio**
> (genérica, sin stack); el binding a herramientas concretas (`bigint`, SQL,
> etc.) vive en `profile-ts-next-supabase.md`. Cada fila es una regla de
> primera clase (Manifiesto v5.0, Parte 2).

| ID | Garantía | Mecanismo | Tecnología | Evidencia |
|---|---|---|---|---|
| `EXT-FIN-001` | El dinero es un **tipo exacto**: centavos como entero mínimo. `float`/`double`/`number` están prohibidos para dinero. | Tipo entero con escala de divisa (centavos); aritmética entera, sin coma flotante. | Entero mínimo (centavos); `bigint` en TS vía perfil. | E1 typecheck + grep invariante (no `number`/`Math.round` en `financial`/`payroll`); E2 `tests/lib/money.test.ts`. |
| `EXT-FIN-002` | El redondeo en el límite `.5` es **medio-arriba** (round half up), determinista. | `roundHalfUp` sobre pares enteros: `⌊(n·k + d/2)/d⌋` con numerador/denominador enteros. | Función pura `roundHalfUp(numerador, denominador)`. | E2 test del límite `.5` (`14¢ × 3/28 = 1.5¢ → 2¢`, `tests/lib/cash-reserve.test.ts`). |
| `EXT-FIN-003` | Las **tasas son racionales exactas**; jamás un decimal de coma flotante. | Tasa = par `(numerador, denominador)` entero; fuente única. | Constantes `GST_RATE`/`PST_RATE` como racionales; re-export, no re-declaración. | E1 grep (una sola declaración); E2 tests de importación. |
| `EXT-FIN-004` | Una mutación monetaria con la misma `Idempotency-Key` **no se aplica dos veces**; el replay devuelve respuesta idéntica. | `UNIQUE (idempotency_key, scope)` + middleware que exige `Idempotency-Key`. | Constraint `UNIQUE` + middleware de idempotencia. | E2/E3 double-execution replay: mismo key dos veces → sin filas duplicadas y respuesta idéntica. |
| `EXT-FIN-005` | Los asientos publicados son **inmutables**; toda corrección es un asiento de **compensación tipificada**, no un `UPDATE`/`DELETE`. | Ledger **append-only** (sin `UPDATE`/`DELETE` sobre asientos publicados); compensación vía asiento con tipo (`reversal`/`correction`) y enlace al origen. | Permisos/RLS que niegan `UPDATE`/`DELETE` + columnas `entry_type`/`reverses`. | E3 test de integración (`UPDATE`/`DELETE` rechazado; reversión tipificada cuadra); E1 probe RLS. |
| `EXT-FIN-006` | **Partida doble:** todo asiento publica débito = crédito (suma cero por asiento). | Invariante de balance `Σ débito = Σ crédito` aplicado en la publicación. | Constraint/trigger o validación en el servicio de publicación. | E2/E3: asiento desbalanceado rechazado. |
| `EXT-FIN-007` | El ledger **cuadra** contra la cuenta puente; toda diferencia se detecta. | Job de **reconciliación** ledger vs cuenta puente; diferencias emiten alerta. | Job programado + alerta P0/P1. | E5 drill de reconciliación; E3 test de diferencias. |
| `EXT-FIN-008` | Las **reglas fiscales son datos versionados** con vigencia; nunca hardcodeadas en lógica. | Tabla de reglas con `version`, `effective_from`/`effective_to`; la lógica consulta la versión vigente. | Datos + migración versionada; aprobación humana documentada (commit firmado). | E3 (versión vigente aplicada); E4 aprobación con commit firmado. |
| `EXT-FIN-009` | Un pago solo transita por **estados permitidos**; un estado ilegal es irrepresentable. | Máquina de estados finita: enum de estados + mapa de transiciones; transición fuera del mapa rechazada. | Enum/union type + guard de transición. | E2 property test de transiciones (todas las legales pasan, las ilegales no). |

## Reglas de primer clase (Parte 2)

```yaml
rules:
  - { id: "EXT-FIN-001", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-FIN-002", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-FIN-003", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-FIN-004", property_protected: "integrity", evidence_level: "E3", exceptions: { allowed: false } }
  - { id: "EXT-FIN-005", property_protected: "integrity", evidence_level: "E3", exceptions: { allowed: false } }
  - { id: "EXT-FIN-006", property_protected: "integrity", evidence_level: "E3", exceptions: { allowed: false } }
  - { id: "EXT-FIN-007", property_protected: "integrity", evidence_level: "E5", exceptions: { allowed: false } }
  - { id: "EXT-FIN-008", property_protected: "regulatory", evidence_level: "E3", exceptions: { allowed: true, waiver_path: ".governance/waivers/" } }
  - { id: "EXT-FIN-009", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: false } }
```

> Las reglas derivadas de invariantes de Nivel 1 (`EXT-FIN-001..007`, `009`)
> tienen `exceptions.allowed: false`: **sin waiver ni break-glass** (Manifiesto
> v5.0, Parte 5.5). `EXT-FIN-008` (reglas fiscales como datos) admite waiver,
> no break-glass sobre la inmutabilidad del ledger.
