# Simulacro break-glass — Lulu Island Flagship

**Primer simulacro (tabletop) · 2026-08-15**

> Materializa el **Parte 5.4** del
> [`Manifiesto v5.0`](Manifiesto-v5.0.md) y el protocolo de
> [`.governance/break-glass/README.md`](../.governance/break-glass/README.md).
> Un **tabletop** no toca producción: se recorre el protocolo con un escenario
> concreto, se detectan huecos y se registra la lección. No es un incidente
> real; es el ejercicio que valida la vía de escape.

---

## 1. Objetivo del simulacro

Verificar end-to-end, **sin escribir en producción**, que la vía break-glass:

1. se activa con **M/N firmas** (2/2 en esta instancia);
2. queda registrada como **asiento inmutable** en
   `.governance/break-glass/log.yaml`;
3. respeta **TTL máximo de 24 h** y **revocación automática**;
4. exige **incident-to-test** antes de dar el incidente por cerrado.

---

## 2. Escenario concreto (SEV-0)

**`BG-DRILL-2026-08-15` — Tasa fiscal errónea publicada como dato versionado.**

A las **09:00 UTC** del 2026-08-15 se publicó por error la versión
`FG-GST-2026Q3-v2` de la regla fiscal con `numerator: 6` (6 %) en lugar de
`5` (5 %). Todas las capturas de cobro del nuevo período fallan el gate de
integridad financiera (`subtotal + gst + pst === total` se rompe), deteniendo
la captura de cobros.

El flujo normal exige separación **`CREATOR ≠ APPROVER`** para publicar la
versión correctora `FG-GST-2026Q3-v3`, pero el único `APPROVER` registrado
está incomunicado. Es **SEV-0**: cada minuto de espera agrava la interrupción
de cobros.

- **Qué se necesita:** publicar **una única** versión correctora
  `FG-GST-2026Q3-v3` (INSERT en `fiscal_rules`).
- **Qué NO se concede:** `UPDATE`/`DELETE` sobre versiones ya publicadas, ni
  acceso al `financial_ledger` (append-only, Nivel 1 → sin break-glass).

---

## 3. Quién activa

| Rol | Actor | Función |
|---|---|---|
| `CREATOR` (on-call) | `@ops-oncall` | Firma 1 — ejecuta la publicación correctora. |
| Segunda firma | `@security-owner` | Firma 2 — confirma el alcance acotado. |
| **M/N** | **2/2** | Definido por la instancia para esta vía. |

**Fallback equipo de una persona** (Manifiesto 5.4 / README §Reglas 1): firma
del on-call + **contrafirma diferida** de un aprobador externo
(`@finance-approver`) registrada dentro del incidente, o firma directa del
aprobador externo. El asiento debe consignarlo en `contrafirma_diferida`.

---

## 4. Registro en `.governance/break-glass/log.yaml`

La activación se añade **al final** del array `activaciones` del `log.yaml`
(append-only: una entrada escrita nunca se edita ni se borra). Asiento de
ejemplo producido por el simulacro:

```yaml
# Asiento de ejemplo (simulacro). En el drill NO se escribe en el log real;
# el asiento vive aquí o en un fixture de test para ejercitar el gate.
- activacion_id: "BG-2026-08-15-001"
  motivo: "SEV-0: versión fiscal FG-GST-2026Q3-v2 errónea (6% en vez de 5%) bloquea captura de cobros; APPROVER incomunicado"
  firmas: ["@ops-oncall", "@security-owner"]        # M/N = 2/2
  contrafirma_diferida: null
  privilegios:
    - "INSERT fiscal_rules (única versión correctora FG-GST-2026Q3-v3)"
    - "NO UPDATE/DELETE sobre versiones publicadas"
    - "NO acceso a financial_ledger"
  activado_en: "2026-08-15T09:00:00Z"
  ttl_horas: 24
  expira_en: "2026-08-16T09:00:00Z"
  alerta_p0: true
  incident_to_test: "tests/lib/fiscal-rules-regression.test.ts"
  estado: "ACTIVO"
```

> **Simulacro vs. log real:** el tabletop **no** escribe en el `log.yaml` de
> producción. Para ejercitar el gate de `verify:invariants` se usa un fixture
> de test con el asiento de arriba, nunca el log real.

---

## 5. TTL de 24 h y revocación

- **TTL:** `ttl_horas` no puede superar **24**. El privilegio nace en
  `activado_en` y muere en `expira_en = activado_en + ttl_horas`
  (`2026-08-16T09:00:00Z`).
- **Revocación automática:** al alcanzar `expira_en`, los privilegios
  concedidos se **revocan solos**; el asiento permanece en el log para
  auditoría.
- **Revocación anticipada:** se registra como **asiento posterior**
  (append-only) con `revocado_en` (ISO 8601) y `estado: "REVOCADO"`. El
  asiento original **no se edita**.
- **Gate:** `verify:invariants` falla si existe una activación con
  `expira_en < now` sin `revocado_en`, o con `ttl_horas > 24`, o con
  `expira_en != activado_en + ttl_horas` (ver lección `LEARNING-005`).

---

## 6. Cierre del incidente (incident-to-test)

Antes de cerrar, es obligatorio (Parte 5.4 / README §Reglas 5):

1. **Test que reproduce el fallo:** `tests/lib/fiscal-rules-regression.test.ts`
   verifica que una versión fiscal vigente errónea rompe el invariante de
   totales y que la versión correctora `v3` lo restaura.
2. **Test que pasa:** la versión `v3` vigente devuelve
   `subtotal + gst + pst === total` para el período afectado.
3. **Vía normal restaurada:** el `APPROVER` publica `v3` por el proceso
   ordinario; el break-glass solo cubrió el hueco mientras tanto.

---

## 7. Lección aprendida — `@incident LEARNING-005`

Enlace bidireccional (Manifiesto v5.0, Parte 6.4) →
[`docs/LEARNINGS.md`](LEARNINGS.md).

### `@incident LEARNING-005` — El gate de break-glass validaba el TTL declarado, no el TTL real

- **Fecha:** 2026-08-15 (simulacro tabletop)
- **Contexto / riesgo:** `identity`/`operations` · `integrity: HIGH`,
  `blast_radius: HIGH` (privilegios administrativos temporales)
- **Causa raíz:** el gate de `verify:invariants` comprobaba el campo
  `ttl_horas` **declarado** (≤ 24), pero no la invariante temporal derivada
  `expira_en == activado_en + ttl_horas`. Un asiento con `ttl_horas: 24` y un
  `expira_en` lejano pasaba el gate y dejaba el privilegio abierto.
- **Reproducción mínima:** registrar un asiento con `ttl_horas: 24` y
  `expira_en: +30 días`; `verify:invariants` no lo rechazaba.
- **Test que falla:** gate de break-glass — no rechazaba un `expira_en`
  incoherente con `ttl_horas`.
- **Fix:** añadir al gate la verificación de **TTL real**:
  `expira_en == activado_en + ttl_horas` **y** `ttl_horas <= 24` (equivale a
  `expira_en - activado_en <= 24h`).
- **Test que pasa:** asiento con `expira_en != activado_en + ttl_horas`
  rechazado; asiento coherente (24 h exactas) aceptado.
- **Enlace a la causa:** `.governance/break-glass/log.yaml` +
  gate `verify:invariants` (sección break-glass).
- **Regla / medida que lo evita ahora:**
  `.governance/break-glass/README.md` — el gate valida el **TTL real
  (derivado)**, no el campo declarado.

> **Pendiente de materializar (fuera del alcance de este artefacto):** añadir
> esta entrada a `docs/LEARNINGS.md` como `@incident LEARNING-005` para
> completar la bidireccionalidad exigida por Parte 6.4.

---

## 8. Resultado del simulacro

| Check | Resultado |
|---|---|
| Activación M/N (2/2) | ✅ |
| Asiento inmutable append-only | ✅ |
| TTL 24 h + revocación automática | ⚠️ hueco detectado → `LEARNING-005` |
| Alerta P0 | ✅ |
| Incident-to-test antes de cerrar | ✅ |

**Veredicto del drill:** la vía de escape funciona, pero el gate confiaba en el
campo `ttl_horas` declarado en vez de validar el TTL real derivado. Corregido
(lección `LEARNING-005`). **El próximo drill** debe re-ejercitar el gate con el
asiento incoherente para confirmar que el hueco quedó cerrado.
