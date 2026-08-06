# Dashboard Cards — Decisiones de Nomenclatura

> Última actualización: 2026-08-04
> Aplicable a: Admin Dashboard (modo Manual)

---

## Principio rector

El dashboard no es un menú. Es una respuesta a la pregunta: **"¿Qué requiere mi atención hoy?"**

Por eso se reduce a **12 cards principales** + navegación lateral por módulos. Todo lo demás es ruido.

---

## Decisiones puntuales

### 1. Verbos para acciones, sustantivos para métricas

Las cards de acción pendiente llevan verbo en imperativo. Las de KPI llevan sustantivo.

| ¿Por qué? | Si el admin ve "Quote Approval", piensa "esto es información". Si ve "Review Quotes", piensa "esto es mi trabajo de hoy". Un verbo es una invitación a actuar; un sustantivo es una etiqueta de archivo. |
|---|---|

**Aplicado en:** `Review Quotes`, `Review Upsells`, `Approve Services`, `Review Alerts`, `Review Services`, `Today's Dispatch`.

---

### 2. "Batch Capture Success" → "Payment Success"

Técnicamente, "batch capture" es el cierre del lote de autorizaciones. Pero el usuario del dashboard no opera el merchant processor; quiere saber si el dinero entró. La precisión técnica del desarrollador no justifica un nombre opaco para el operador.

| Excepción | Si el módulo se usa en un contexto financiero avanzado (controller, contador externo), se puede renombrar a "Batch Close Rate". |
|---|---|

---

### 3. "Contribution Margin" queda fuera del dashboard principal

Es una métrica financiera avanzada (Revenue − Variable Costs). El admin operativo no la usa para decidir qué hacer hoy. Va al módulo **Finance**.

| ¿Por qué no "Gross Margin"? | Porque eso es otra métrica distinta (Revenue − COGS). Mezclarlas es un error contable que lleva a decisiones de precios erróneas. |
|---|---|

---

### 4. "CRA Remittances" → "CRA Deadlines"

"Remittances" es jerga contable canadiense. "Deadlines" comunica lo que el admin realmente necesita saber: *¿qué debo pagar y cuándo?* La sigla CRA se mantiene porque es el vocabulario real del dueño de negocio en BC.

---

### 5. "Live Portfolio" → "Candidate Pool"

"Portfolio" es una metáfora financiera incorrecta. El módulo muestra candidatos auto-surfaced para aprobación rápida. No es un portafolio de inversión ni de clientes. "Pool" describe exactamente lo que es: un depósito de candidatos activos.

---

### 6. "Coworker Rotation" → "Team Rotation"

"Coworker" es corporativo; "cuadrillas" asume construcción. En servicios de campo en BC, "team" es el término que usan los supervisores. La regla subyacente (mínimo 3 compañeros distintos al mes) se mantiene igual.

---

### 7. "QC Wall" → "Approve Services"

"QC" es abreviatura interna. "Wall" no significa nada fuera del equipo de desarrollo. La card sirve para aprobar o rechazar servicios completados con evidencia fotográfica. El nombre debe describir la acción, no la implementación técnica.

---

### 8. "DR Drills" → "Recovery Drills"

"DR" (Disaster Recovery) es sigla de infraestructura de TI. El admin del negocio no piensa en términos de TI; piensa en "¿podemos operar si falla algo crítico?". "Recovery" mantiene el sentido sin la jerga.

---

### 9. "Alert Inbox" → "Review Alerts"

"Inbox" es redundante. Una alerta ya implica que entró a un buzón. Se reduce a "Alerts" en el menú lateral, pero en el dashboard principal lleva verbo: "Review Alerts".

---

### 10. Bilingüismo exacto, no adaptativo

Inglés y español son traducciones literales del mismo concepto. No se adaptan culturalmente.

| ❌ Incorrecto | ✅ Correcto |
|---|---|
| "Quote Approval" / "Aprobación de Presupuestos" | "Review Quotes" / "Revisar Cotizaciones" |
| "Upsell Review" / "Revisión de UpSells" | "Review Upsells" / "Revisar Ventas Adicionales" |
| "At-Risk Clients" / "Clientes en Riesgo de Fuga" | "At-Risk Clients" / "Clientes en Riesgo" |

---

## Dashboard Principal (12 cards)

| # | Inglés | Español | Tipo |
|---|--------|---------|------|
| 1 | **Business Health** | **Salud del Negocio** | KPI |
| 2 | **Review Services** | **Revisar Servicios** | Acción |
| 3 | **Review Quotes** | **Revisar Cotizaciones** | Acción |
| 4 | **Review Upsells** | **Revisar Ventas Adicionales** | Acción |
| 5 | **Approve Services** | **Aprobar Servicios** | Acción |
| 6 | **Review Alerts** | **Revisar Alertas** | Acción |
| 7 | **Today's Dispatch** | **Despacho de Hoy** | Acción |
| 8 | **At-Risk Clients** | **Clientes en Riesgo** | KPI |
| 9 | **Net Margin** | **Margen Neto** | KPI |
| 10 | **Team Score** | **Puntuación del Equipo** | KPI |
| 11 | **CRA Deadlines** | **Vencimientos CRA** | Monitoreo |
| 12 | **Backup Status** | **Estado de Respaldos** | Monitoreo |

---

## Módulos de navegación lateral

Todo lo que no requiere atención diaria inmediata.

| Módulo | Cards incluidas |
|--------|-----------------|
| **People** | Employees, Applicants, Teams, Team Rotation, Certifications, Wellbeing, Marketing |
| **Clients** | New Clients, Segments, Candidate Pool, Campaigns, Gifts, Neighborhood |
| **Finance** | Contribution Margin, Pricing Rules, Pricing Settings, Payroll Export, Insurance, Economic Settings, Partners, Payment Success |
| **Compliance** | Labor Compliance, Privacy, Contract Renewals, Legal Updates, Incidents |
| **System** | Recovery Drills, Stress Test, Migration Closure, Experiments, Local SEO, Growth Metrics, Attribution |

---

## Notas abiertas (requieren validación con usuario final)

1. **"Upsell" vs "Cross-sell"**: Si el equipo interno usa "venta cruzada", renombrar a `Review Cross-Sells` / `Revisar Ventas Cruzadas`.
2. **"Team" vs "Crew"**: Validar con supervisores de campo en BC cuál es el término habitual.
3. **"Candidate Pool" vs "Talent Pool"**: Confirmar si "talent" es demasiado corporativo para una empresa de servicios de limpieza.

---

*Documento vivo. Cualquier desviación de estos 12 nombres debe justificarse contra la pregunta: "¿Qué necesita saber el admin hoy?"*
