# Manifiesto de Gobernanza de Software — v5.0

**Núcleo genérico · Framework universal de gobernanza ejecutable**

> **Qué es:** un marco de gobernanza de software, genérico por diseño. No depende de un dominio de negocio ni de un stack tecnológico. Define *qué propiedades deben preservarse, contra qué riesgos, con qué controles y con qué evidencia*, para cualquier proyecto.
>
> **Qué no es:** no es el protocolo operativo de un proyecto concreto (eso es una *instancia*), ni una especificación de producto (eso vive aparte). No contiene reglas de dominio (dinero, diseño, auth) ni tokens de stack (TypeScript, Zod, npm).
>
> **Cómo se compone:** este núcleo se combina con *extensiones* (dominio), *perfiles* (stack) y se materializa en una *instancia* por proyecto (Parte 7).
>
> **Invariante rector del propio documento:** cero reglas en prosa. Toda regla normativa es un artefacto parseable con mecanismo de enforcement y evidencia. Una regla que no se puede ejecutar no existe.

---

## PARTE 0 — CONSTITUCIÓN

### 0.1 Invariantes universales (no negociables)

1. **Lo incorrecto debe ser irrepresentable.** Tipos, esquemas, constraints y gates impiden los estados ilegales; no se confía en que nadie los introduzca.
2. **Las garantías viven en mecanismo, no en prosa.** Un principio sin test, linter, constraint, schema o gate no existe.
3. **Toda regla normativa es un objeto de primera clase.** Tiene identidad, ámbito, propiedad protegida, enforcement y evidencia exigida (Parte 2). Una lista de prohibiciones en prosa no es gobernanza.
4. **Todo cambio crítico es reversible y aislable.** Blast radius acotado, rollback probado, evidencia de reversión.
5. **Toda mutación crítica es idempotente.** Clave de idempotencia verificada por mecanismo más restricción de unicidad.
6. **La información crítica es verificable y reconstruible.** Integridad sin disponibilidad ni recuperación probada no es protección.
7. **La verdad se demuestra con evidencia, no con confianza.** Toda afirmación de cumplimiento cita su mecanismo y su prueba (Parte 4).
8. **Toda excepción es un mecanismo auditado, no un texto libre.** Waiver y break-glass son artefactos con expiración, aprobador y control compensatorio (Parte 5).
9. **El núcleo no depende de dominio ni de stack.** Ningún invariante de dominio ni token tecnológico vive en el núcleo. Una fuga de dominio o de stack es un bug del documento.

### 0.2 Jerarquía de precedencia

En conflicto, gana el nivel menor:

- **Nivel 1 — Invariantes constitucionales:** corrección, integridad, aislamiento de fallos, idempotencia, reversibilidad, evidencia.
- **Nivel 2 — Arquitectura de gobernanza:** modelo cuaternario, esquema de reglas, modelo de riesgo, válvulas de escape.
- **Nivel 3 — Políticas:** decisiones de plataforma, librerías, proveedores (viven en el *perfil* o la *instancia*).
- **Nivel 4 — Convenciones:** estilo, nomenclatura, organización (jamás justifican vulnerar un Nivel 1).

> **Regla de oro:** imitar el código preexistente es Nivel 4. Jamás justifica violar un invariante. Una violación preexistente se corrige y se marca `[FIX]`.

### 0.3 Límites de autoridad (qué NO hace el sistema)

- No aplica migraciones destructivas de forma autónoma.
- No aprueba su propio cambio crítico.
- No declara terminado sin evidencia ejecutable.
- No rota secretos ni escribe credenciales en logs, commits o terminales.
- **No emite waiver sobre un invariante de Nivel 1.**

---

## PARTE 1 — MODELO CUATERNARIO

Toda exigencia se expresa en cuatro capas, cada una con un estatus normativo distinto.

### 1.1 Las cuatro capas

| Capa | Pregunta | Contenido | Estatus |
|---|---|---|---|
| **Garantía** | ¿qué debe ser verdad? | La propiedad que se preserva | Normativa (obligatoria) |
| **Mecanismo** | ¿cómo se hace cumplir? | El enforcement verificable | Normativo (al menos uno presente) |
| **Tecnología** | ¿con qué se implementa? | La herramienta concreta | Intercambiable |
| **Evidencia** | ¿cómo se demuestra? | La prueba de que funciona | Obligatoria |

### 1.2 Estado normativo (la regla que evita el sobre-alcance)

- **Garantía** es innegociable: si no puedes decir qué propiedad se preserva, no hay regla.
- **Mecanismo** es normativo: debe existir *al menos un* mecanismo verificable de una lista permitida, presente y probado. No se degrada a catálogo de sugerencias.
- **Tecnología** es intercambiable: una librería puede desaparecer sin tocar la garantía ni el mecanismo.
- **Evidencia** es obligatoria: una garantía sin prueba es prosa.

> La distinción crítica: **solo la tecnología es intercambiable.** Si el mecanismo se vuelve opcional, la gobernanza vuelve a ser prosa.

### 1.3 Ejemplo (genérico, sin stack)

```yaml
garantia: "una mutación crítica no se aplica dos veces por el mismo motivo"
mecanismo:
  permitidos:
    - clave_de_idempotencia_verificada
    - restriccion_de_unicidad
  seleccionado: [clave_de_idempotencia_verificada, restriccion_de_unicidad]
tecnologia: "<definida por el perfil de stack>"
evidencia:
  - test_de_reintento_identico
  - test_de_concurrencia
```

---

## PARTE 2 — ESQUEMA DE REGLAS (objetos de primera clase)

Cada regla normativa es un objeto con el siguiente schema.

### 2.1 Schema universal

```yaml
rule:
  id: "CORE-INTEGRITY-001"          # único y estable; se referencia por ID, nunca por número de sección
  statement: "los datos publicados no se editan ni borran"
  applies_when:
    domain: "*"                      # o un bounded context específico
    state: "published"
  property_protected: "integrity"
  risk_if_violated:
    severity: "CRITICAL"
    consequences: ["corrupción de datos", "fallo de auditoría"]
  enforcement:
    mechanisms: ["inmutabilidad_por_permisos"]   # al menos uno verificable
  verification:
    evidence_level: "E3"             # mínimo exigido (Parte 4)
    required: ["migración", "test_de_integración"]
  exceptions:
    allowed: false                   # false para reglas derivadas de Nivel 1
    waiver_path: "ninguno"
  evidence_required: ["referencia_de_implementación", "prueba_automatizada"]
```

### 2.2 Bounded contexts

`applies_when.domain` referencia un *bounded context* declarado por la instancia. Un linter no puede resolver "dominio financiero" en abstracto; sí puede resolver "toda ruta bajo `src/lib/pricing`". La instancia es quien mapea carpetas a contextos.

```yaml
bounded_contexts:
  - id: "financial"
    paths: ["src/lib/pricing", "src/lib/tax*"]
  - id: "identity"
    paths: ["src/auth"]
```

### 2.3 Regla de cota superior

Cuando un cambio toca varios contextos, rige el requisito más estricto entre los contextos afectados (el máximo, no el promedio, no el mínimo).

### 2.4 Default para contextos no clasificados

Toda ruta debe pertenecer a un contexto. Una ruta sin clasificar se trata como `UNCLASSIFIED` y **bloquea el gate** hasta que se clasifique. No hay agujero silencioso.

---

## PARTE 3 — MODELO DE RIESGO MULTIDIMENSIONAL

Sustituye la clasificación unidimensional (L0/L1/L2) por un perfil por dimensiones, que preserva la información en lugar de comprimirla en un solo número.

### 3.1 Dimensiones del perfil de riesgo

```yaml
risk_profile:
  confidentiality:    NONE|LOW|MEDIUM|HIGH|CRITICAL
  integrity:          NONE|LOW|MEDIUM|HIGH|CRITICAL
  availability:       NONE|LOW|MEDIUM|HIGH|CRITICAL
  reversibility:      NONE|LOW|MEDIUM|HIGH|CRITICAL
  financial_exposure: NONE|LOW|MEDIUM|HIGH|CRITICAL
  regulatory:         NONE|LOW|MEDIUM|HIGH|CRITICAL
  privacy:            NONE|LOW|MEDIUM|HIGH|CRITICAL
  blast_radius:       NONE|LOW|MEDIUM|HIGH|CRITICAL
```

`OVERALL` se calcula como el máximo de las dimensiones, **sin perder** el desglose: el desglose es la decisión, el máximo es solo el resumen.

### 3.2 Tabla de decisión (dimensión → aseguramiento requerido)

| Dimensión en CRITICAL | Aseguramiento requerido |
|---|---|
| integrity | evidencia ≥ E3 · inmutabilidad por mecanismo · verificación independiente |
| financial_exposure | extensión financiera activa · partida doble · idempotencia · reconciliación |
| privacy | minimización · enmascarado en logs · cifrado donde aplique |
| reversibility | rollback probado · expand-contract |
| availability | RPO/RTO documentados · drill de restauración probado |
| regulatory | reglas como datos versionados · aprobación humana documentada |

### 3.3 Perfiles de adopción

- **Mínimo:** solo Nivel 1 (invariantes) más garantías críticas. Para scripts y prototipos.
- **Estándar:** más esquema de reglas y evidencia E1–E3. Para servicios normales.
- **Completo:** más verificación independiente (E4), válvulas de escape y deuda de waiver. Para mutaciones críticas.

### 3.4 Diff-aware (sin parálisis)

El análisis de riesgo no se debate manualmente por cada cambio. Cada contexto tiene su vector predefinido. Un script lee el `git diff`, determina qué contextos se tocaron, aplica la **cota superior** y activa solo los gates correspondientes. El humano o agente revisa la conclusión; no la calcula desde cero.

---

## PARTE 4 — NIVELES DE EVIDENCIA (E0–E5)

### 4.1 Escala

- **E0 — Declaración:** la afirmación está escrita. No es evidencia; es intención.
- **E1 — Análisis estático:** linter, typecheck, análisis AST, scan de secretos.
- **E2 — Prueba automatizada:** unitaria, property-based, de contrato.
- **E3 — Integración real:** contra un entorno controlado, nunca producción.
- **E4 — Verificación independiente:** otro agente/revisor o spot check, con prompt adversarial.
- **E5 — Evidencia operacional:** observación en producción (métricas, reconciliación, drill).

### 4.2 Evidencia mínima

Cada garantía declara su `evidence_level` mínimo. El nivel lo exige la dimensión de riesgo, no la técnica: la pregunta no es "¿qué técnica uso?", sino "¿qué grado de evidencia necesito para confiar en esta afirmación?".

### 4.3 Grafo de evidencia (MANIFEST_AUDIT)

```markdown
## MANIFEST_AUDIT

### Contexto
- Intención · perfil de riesgo multidimensional · entorno

### Garantías
- [garantía] → [mecanismo] → [prueba] → ESTADO

### Estados
[x] VERIFIED · [UNVERIFIED] · [BLOCKED] · [WAIVED]

### Reglas omitidas
- [WAIVED] rule_id → razón, riesgo, aprobador, expiración, control compensatorio

### Advertencias · LEARNINGS
```

### 4.4 Verificación independiente y fallback solo-dev

El certificador no puede ser solo el ejecutor. En equipo, una segunda persona o agente verifica. En contexto de una sola persona, el fallback obligatorio es la **re-verificación adversarial**: una sesión distinta, con un prompt cuyo objetivo explícito sea *refutar* el AUDIT, no confirmarlo.

---

## PARTE 5 — VÁLVULAS DE ESCAPE MECANIZADAS

El punto más crítico de toda gobernanza son sus excepciones. Aquí no se permite prosa.

### 5.1 Schema de waiver

```yaml
# .governance/waivers/<rule_id>_<fecha>.yaml
waiver:
  rule_id: "CORE-INTEGRITY-001"
  scope: "módulo X, motivo acotado"
  reason: "..."
  compensating_control: "..."
  expires_at: "2026-09-15"
  approver: "<firma de commit del aprobador>"
```

El CI **rompe la build** si `now() > expires_at`. Un waiver vencido es un error de build, no un aviso.

### 5.2 Deuda de waiver

- Máximo de waivers activos: configurable (por defecto 5).
- Antigüedad máxima sin resolver: configurable (por defecto 30 días).
- Superar un umbral falla el gate. La gobernanza de excepciones es cuantificable, no una lista olvidada.

### 5.3 Definición de "aprobación humana documentada"

No es texto libre. Una aprobación válida es un **commit firmado** de un actor con rol verificado, referenciado en el artefacto. La instancia define el mecanismo de firma y de verificación de rol. "Alguien lo aprobó por chat" no constituye aprobación.

### 5.4 Break-glass protocol

Para emergencias SEV-0 donde la segregación normal bloquearía la intervención:

- Activación por **M/N firmas** de on-call (la instancia define M y N; para equipo de una persona, contrafirma diferida documentada o aprobador externo).
- El evento de activación es **inmutable y queda registrado** (como un asiento, no como un mensaje).
- **TTL máximo** (por defecto 24 h, configurable). Al expirar, el privilegio se revoca solo.
- Dispara **alerta P0** a toda la organización.
- Antes de cerrar el incidente, exige un **test de regresión** (incident-to-test).

No debilita la segregación: crea un conducto auditable más difícil de abusar que pedir acceso por chat.

### 5.5 Regla dura

**Un waiver o un break-glass no puede aplicarse a una regla derivada de un invariante de Nivel 1.** Las reglas con `exceptions.allowed: false` no tienen camino de excepción.

---

## PARTE 6 — WORKFLOW Y CAMBIO

### 6.1 Workflow

```
[CONTEXT GATE] → [RIESGO MULTIDIMENSIONAL] → [FRENO / DISEÑO]
→ [IMPLEMENTACIÓN] → [QUALITY GATES] → [AUDIT] → [OBSERVAR] → [APRENDER]
```

### 6.2 CHANGE como objeto de primera clase

```yaml
change:
  id: "CHG-<fecha>-<secuencia>"
  intent: "..."
  scope:
    contexts: ["financial"]
    modules: ["billing", "ledger"]
  risk_profile: { ... }                 # multidimensional, calculado del diff
  decisions_required: ["política_de_redondeo"]
  invariants_affected: ["EXT-FIN-001"]
  verification_plan: ["unit", "integration", "property"]
  rollback_plan: "..."
  evidence:
    status: "PENDING"
```

### 6.3 Bootstrap de sesión

Antes del CONTEXT GATE, obligatorio: leer `LEARNINGS.md` (o equivalente) y el último `MANIFEST_AUDIT`. Sin este paso, las lecciones no se aplican.

### 6.4 Incident-to-learnings

Todo defecto crítico genera: reproducción mínima → test que falla → fix → test que pasa → regresión bloqueada, enlazado bidireccionalmente a su entrada en LEARNINGS (`@incident LEARNING-XXX`).

---

## PARTE 7 — CONTRATO DE COMPOSICIÓN

### 7.1 Las cuatro piezas

| Pieza | Contiene | Depende de | Versiona |
|---|---|---|---|
| **Núcleo** (este documento) | constitución, esquemas, riesgo, evidencia, válvulas | nada | sola |
| **Extensión** | garantías y mecanismos de un dominio | núcleo | sola |
| **Perfil** | binding de mecanismos a un stack | núcleo | sola |
| **Instancia** | decisiones concretas de un proyecto | núcleo + extensiones + perfil | pinnea versiones |

### 7.2 Schema de extensión

```yaml
extension:
  id: "ext-financial"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  provides_capabilities: ["DineroExacto", "PartidaDoble"]
  rules: [ ... ]        # usando el schema de regla (Parte 2)
```

### 7.3 Schema de perfil

```yaml
profile:
  id: "ts-next-supabase"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  binds:
    - mechanism: "inmutabilidad_por_permisos"
      technology: "<tooling concreto del stack>"
```

### 7.4 Schema de instancia (superficie mínima conformante)

```yaml
instance:
  name: "<proyecto>"
  core: "5.0.0"
  extensions: ["ext-financial", "ext-design"]
  profile: "ts-next-supabase"
  bounded_contexts: { ... }
  ci:
    command: "verify:invariants"
  operational_rules: [ ... ]   # reglas específicas heredadas o migradas
```

### 7.5 Versionado

El núcleo versiona solo (SemVer). Una instancia **pinnea** la versión del núcleo. Un cambio en un perfil no mueve la versión del núcleo; un cambio en una instancia no mueve nada más que la instancia.

---

## PARTE 8 — CATÁLOGOS DE REFERENCIA (no normativos en el núcleo)

Estas extensiones y perfiles se definen en artefactos separados. Se listan aquí como referencia de composición; su contenido normativo vive en sus propios documentos.

### 8.1 ext-financial (referencia)

Garantías: dinero como tipo exacto (no flotante); inmutabilidad de asientos publicados; idempotencia de mutaciones monetarias; partida doble; reconciliación contra cuenta puente; reglas fiscales como datos versionados. Mecanismos: tipo entero con escala de divisa; restricción de unicidad de idempotencia; append-only con compensación tipificada; job de reconciliación. El detalle (escala ISO 4217, redondeo simétrico, máquina de estados de pago) vive en la extensión, no aquí.

### 8.2 ext-design (referencia)

Garantías: accesibilidad como invariante (contraste, foco visible, jerarquía de encabezados); estética de fuente única. Mecanismos: tokens semánticos compilados en build; regresión visual; checks de contraste y foco en CI.

### 8.3 ext-auth (referencia)

Garantías: segregación de funciones; autorización en cada operación privilegiada. Mecanismos: RBAC/RLS; `CREATOR ≠ APPROVER ≠ RECONCILER`; break-glass (Parte 5).

### 8.4 profile-ts-next-supabase (referencia)

Bindings concretos: tipo entero → `bigint` de TypeScript; validación declarativa → Zod; RLS → políticas de Supabase; idempotencia → `UNIQUE` más middleware. Aquí —y solo aquí— aparecen TypeScript, Zod, `npx tsc` y npm. El núcleo no los conoce.

---

## ANEXO — ANTI-PATRONES DESCARTADOS

- Prosa como gobernanza (reglas que no se ejecutan).
- Un solo número de riesgo que comprime dimensiones distintas.
- Mecanismo como catálogo de sugerencias (garantía sin enforcement).
- Event sourcing global (solo donde el dominio lo exige).
- Meta-sistema autónomo (el humano valida).
- Blockchain o WORM externa, chaos engineering y ontología formal como línea base.
- Hot-patching en producción.
- Métricas inventadas o arbitrarias (porcentajes sin metodología, umbrales sin origen).
- Retórica de absolutos ("100% seguro", "irrompible").
- Ciencia ficción (auto-evolución, conciencia de negocio).
- Generador automático de arquitectura.
- Excepción por texto libre (waiver sin schema).
- Fuga de dominio o stack al núcleo.

---

*Documento vivo. Una regla incumplida es un bug del código o del proceso. Ningún sistema es perfecto; este promete verificable, reparable, reversible y recuperable — y ahora, además, componible y genérico.*
