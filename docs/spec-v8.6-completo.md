# SISTEMA OPERATIVO DE ASEO v8.6 — ESPECIFICACIÓN COMPLETA
## Lulu Island Flagship — Cleaning Services | Richmond, B.C.

**Versión:** 8.6 (consolidación de v8.3 + Mejoras8.3v0.2 + FinancialCore_v0.2 + spec-v8.5-landing + lo construido)
**Fecha:** 6 de Agosto, 2026
**Jurisdicción:** British Columbia, Canadá
**Este documento reemplaza al v8.3 y todos los anexos como fuente única del sistema.**

---

# PARTE A: QUÉ ES v8.6

v8.6 no es una etapa más del plan v8.3. Es la **fotografía completa del sistema tal como existe hoy** — lo planeado, lo mejorado, lo construido, y lo que emergió durante la construcción que nunca estuvo en ningún plan.

A diferencia del v8.3 (que decía «asume que no existe nada»), el v8.6 **reconoce lo construido como cimiento**. No se descarta nada. Se documenta todo.

---

# PARTE B: INVARIANTES DEL SISTEMA

Estos aplican a todo el sistema, siempre. Son la constitución del código.

1. **Realidad física objetiva.** El sistema opera sobre metros cuadrados reales (BC Assessment), horas-hombre reales (HHE), químicos reales (SDS), y fotos reales (timestamped). Nunca sobre estimaciones subjetivas.
2. **El precio es fijo y upfront.** El cliente nunca ve horas. BC Assessment provee el tamaño real. El cotizador devuelve precio firme, no rango.
3. **Transacción atómica con partida doble.** Cada evento de negocio genera su journal entry en la misma transacción PostgreSQL. Si el JE falla, la transacción de negocio falla. Rollback atómico.
4. **Nunca soft-delete en datos financieros.** Marcar inactivo, nunca borrar. Todo reversible.
5. **Versiones, nunca ediciones.** Reglas legales, COA, pricing — nueva versión, nunca editar la vigente.
6. **Evidencia sobre opinión.** Toda disputa se resuelve con fotos timestamped, no con «el cliente dice / el empleado dice».
7. **Export, nunca import.** El sistema nunca lee de QBO/Xero. Solo escribe hacia ellos si el admin lo solicita.
8. **PIPEDA por diseño.** Datos personales con propósito explícito, consentimiento registrado, retención limitada, acceso y rectificación.
9. **El admin manda.** Todo lo que tiene pantalla es del admin. Lo que requiere código es de la IA con revisión.

---

# PARTE C: ARQUITECTURA GENERAL

## C.1 Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes + Supabase (PostgreSQL + Auth + Storage + Realtime) |
| Base de datos | PostgreSQL 15 (Supabase) |
| Auth | Supabase Auth (magic link + OAuth) |
| Pagos | Stripe (Hold + Batch Capture) |
| Email/SMS | Nodemailer + Twilio |
| Mapas/Geocoding | Google Maps Platform |
| BC Assessment | API externa (datos de propiedad) |
| Hosting | Vercel |
| Monitoreo | Observabilidad interna + Supabase logs |

## C.2 Estructura del código

```
src/
├── app/[locale]/          # 175+ rutas (públicas, admin, empleado, portal)
│   ├── page.tsx           # Landing page
│   ├── quote/             # Cotizador 5 pasos
│   ├── booking/           # Reserva
│   ├── portal/            # Portal cliente (my-services, my-properties, wallet, ambassador, preferences)
│   ├── account/           # Cuenta (profile, properties, services, wallet, referrals)
│   ├── employee/          # PWA empleado (checkin, service, chat, keys, safety, score, voting, ritual)
│   ├── admin/             # 65+ rutas admin
│   ├── review/, nps/, survey/  # Formularios post-servicio
│   └── cancellation/, privacy/, terms/, jobs/, confirmation/
├── components/
│   ├── ui/                # shadcn/ui components
│   ├── landing/           # Hero, HowItWorks, FAQ, image slots
│   ├── cotizador/         # StepAddress, StepPurpose, StepDimensions, StepAddonZones
│   ├── reserva/           # Booking calendar, time slots
│   ├── portal/            # Client portal components
│   ├── empleado/          # PWA employee components
│   ├── empleo/            # Job application
│   ├── admin/             # 27+ admin components (Dashboard, Dispatch, QC, Payroll, Tax, etc.)
│   ├── cuenta/            # Account components
│   ├── client-module/     # Shared client components
│   └── legal/             # Legal components
├── lib/                   # 230+ módulos de negocio
│   ├── pricing.ts, bc-assessment.ts, addon-zones.ts  # Cotización
│   ├── financial-ledger.ts, coa.ts, shadow-ledger.ts  # Financial Core
│   ├── compliance-engine.ts, compliance-resolver.ts   # Compliance
│   ├── payroll-engine.ts, payroll-calculator.ts       # Nómina
│   ├── tax-engine.ts, tax-netfile.ts                  # Impuestos
│   ├── dispatch-team.ts, schedule-7030.ts             # Despacho
│   ├── communications.ts, communication-events.ts     # Comunicación
│   ├── stripe.ts, batch-capture-eligibility.ts        # Pagos
│   ├── inventory-dispatch-gate.ts, inventory-reorder.ts # Inventario
│   ├── employee-onboarding.ts, wellbeing.ts           # Empleados
│   ├── live-tracking.ts, team-public-profile.ts       # Tracking
│   ├── marketing, seo, campaigns, competitors         # Crecimiento
│   ├── succession.ts, dr-drill.ts                     # Continuidad
│   └── events.ts (20+ eventos canónicos)
├── hooks/                 # Custom hooks
├── types/                 # TypeScript types
├── i18n/                  # EN, ES, ZH
└── middleware.ts          # Auth + i18n + redirects
```

## C.3 Base de datos

- **305 migraciones** en `supabase/migrations/`
- Migraciones 001-128: Auth, RBAC, core schema
- Migraciones 129-200: Quotes, Orders, Dispatch, Employees
- Migraciones 200-300: Pricing, Inventory, Financial, Communication
- Migraciones 300-350: PIPEDA, compliance, security hardening
- Migraciones 350-359: Communication layer, site_content, landing-images
- Migraciones 360-364: Security audit fixes (FKs, RLS, sentinel)

## C.4 Arquitectura de eventos

El sistema es **event-aware** (no event-driven). Cada evento de negocio, dentro de la misma transacción PostgreSQL, dispara `generateJournalEntry()`. Si el JE falla, la transacción entera hace rollback.

**Eventos canónicos (20+):**

| Evento | Dispara en | Efecto financiero |
|--------|-----------|-------------------|
| `orden.reservada` | Booking | Debit AR, Credit Revenue |
| `hold.capturado` | Batch EOD | Debit Cash, Credit AR |
| `servicio.completado` | QC approval | Debit COGS, Credit Inventory |
| `nomina.calculada` | Payroll cycle | Debit Labor, Credit Wages Payable |
| `inventario.consumido` | Service | Debit Supplies, Credit Inventory |
| `factura.emitida` | AR B2B | Debit AR, Credit Revenue |
| `pago.recibido` | AR B2B | Debit Cash, Credit AR |
| `nomina.pagada` | Payroll close | Debit Wages Payable, Credit Cash |
| `remesa.fiscal.pagada` | Tax remittance | Debit Tax Payable, Credit Cash |
| `comision.partner.pagada` | Partner payment | Debit Commission Exp, Credit Cash |

---

# PARTE D: MÓDULOS DEL SISTEMA (qué existe hoy)

## D.1 Landing Page (v8.5)

**Estado:** ✅ Construido según spec v8.5.

**Especificación completa:** Ver `docs/spec-v8.5-landing-final.md`. Resumen:

- **Cero fotos en lanzamiento.** 3 image slots colapsados que se expanden solo cuando el admin sube imágenes.
- **Texto admin-editable** vía `site_content` (Supabase key/value JSONB). Fallback a `messages/en.json`.
- **Hero:** Campo de dirección + «See your price» (BC Assessment).
- **How It Works:** 4 pasos con texto plano, sin íconos.
- **What's Included / What's Not:** Explícito. Biohazard, moho, plagas = rechazo con referencia a especialista.
- **The Difference:** Pricing pre-decided, chemical lockout, documented profile, no same-team promise.
- **FAQ:** 5 preguntas con tono directo. Garantía condicional a evidencia fotográfica.
- **Flujo:** Dirección → BC Assessment → precio fijo → auth → checkout (Stripe).
- **Paleta:** Navy (#0F1B2A), Ice (#E8F0F8), Wave Blue (#4A90D9), Ink (#1A1A2E).
- **Tipografía:** Inter (UI), Playfair Display (headings).

## D.2 Cotizador (E1 del plan)

**Estado:** ✅ Construido.

- **Flujo 5 pasos:** Dirección → Propósito → Dimensiones → Zonas adicionales → Resumen.
- **BC Assessment:** `src/lib/bc-assessment.ts` — consulta sq ft, tipo, año.
- **Pricing engine:** `src/lib/pricing.ts` — tarifa base × IES (Índice Entrópico de Suciedad) × área × coeficiente de densidad.
- **Zonas con pesos:** Cocina 3.0, Baño 3.0, Sala 2.0, Habitación 1.5, Lavandería 1.5, Pasillo 1.0, Balcón 1.0.
- **Regla dura:** Nunca Cocina + Baño a la misma persona si N≥2.
- **Carga orgánica:** Mascotas (+15% pelo largo), residentes (+5% c/u sobre 2), niños pequeños (+10%).
- **Upsells:** Nevera, horno, ventanas, interior de gabinetes — precios fijos pre-cargados.
- **Pricing sandbox:** `/admin/pricing-rules/sandbox` para simular escenarios sin afectar producción.
- **Límite:** >4,000 sq ft o comercial → «assessment personalizado, te contactamos en 4h».

### D.2.1 Modelo de Precios por Suciedad (IES)

Incorporando las correcciones de Critica_V3_Dignidad:

- **Nivel 1 (IES 1.0):** Mantenimiento. Polvo, pelusa.
- **Nivel 2 (IES 1.5):** Ligera. Grasa fresca, marcas de agua.
- **Nivel 3 (IES 2.5):** Profunda. Sarro visible, grasa pegajosa.
- **Nivel 4 (IES 4.0):** Restauración. Grasa carbonizada, sarro negro. **Límite de intervención.**
- **Nivel 5:** ❌ **RECHAZO DIRECTO.** Biohazard, moho estructural, plagas activas, residuos peligrosos. Se refiere a especialista en remediación.

**Coeficiente de Densidad (corrección a la V3):** Para áreas <10m² en niveles 3-4, el IES se multiplica exponencialmente para reflejar la concentración de suciedad. Con «asíntota de mercado»: si el precio calculado supera el costo de reemplazo −30%, el servicio se clasifica como «No Viable».

## D.3 Booking y Pagos (E2 del plan)

**Estado:** ✅ Construido.

- **Reserva:** Calendario con time slots basado en capacidad real (HHE).
- **Stripe:** Hold + Batch Capture. `src/lib/stripe.ts`, `stripe-client.ts`.
- **Batch capture:** Elegibilidad (`batch-capture-eligibility.ts`), parcial (`batch-capture-partial.ts`), reconciliación (`payment-capture-reconciliation.ts`).
- **Precio fijo:** Sin hourly billing. Sin sorpresas.
- **Cancelación:** 48h gratis, <48h $50 fee, same-day 50%.
- **Garantía:** Condicional a evidencia fotográfica. Si las fotos no matchean, re-service en 24h sin cargo. Si matchean, servicio completo.

## D.4 Capacidad y Despacho (E3 del plan)

**Estado:** ✅ Construido.

- **Despacho:** `dispatch-team.ts`, `dispatch-approval.ts`, `dispatch-fallback.ts`.
- **Modelo 70/30:** 70% horario base (5 días antelación), 30% ventana de contingencia (pagada aunque no se asigne, hasta 5:30 PM día anterior).
- **Formación de equipos:** Líder obligatorio, armado automático por compatibilidad, zona, idioma. Vehículo dedicado.
- **Zonas:** Polígonos editables con recargo. `zone-assignment.ts`, `zone-reparto.ts`, `zone-demand.ts`.
- **Cálculo de capacidad:** `schedule-7030.ts` — slots = capacidad_neta − HHE_comprometidas. Buffer 1 slot/día para emergencias.
- **GPS/ETA:** `live-tracking.ts` — tracking en vivo del vehículo.
- **No-show:** Protocolo de ausencia con reasignación automática.
- **Coordinador integrado (phone booking):** `phone-booking` — reusa pricing.ts y capacidad real para reservas telefónicas.

## D.5 Ejecución del Servicio (E4 del plan)

**Estado:** ✅ Construido.

- **Perfil documentado del hogar:** `src/lib/client-module/` — preferencias, zonas, restricciones, protocolos.
- **Protocolos por zona:** Orden general (ventilar → arriba-abajo → seco antes de húmedo → zonas húmedas primero → fondo hacia puerta → piso al final).
- **Código de colores:** 🔴 Baño, 🔵 Cocina, 🟡 Sala/Habitaciones, ⚪ Ventanas.
- **Chemical lockout:** `chemical-lockout.ts` — validación de compatibilidad química. Nunca amoníaco + ácido juntos.
- **Kitchen timer:** `kitchen-timer.ts` — 10 min espera para superficies calientes.
- **Fotos de cierre:** Time-stamped por zona. Evidencia para QC y disputas.
- **PWA empleado:** Check-in, preparación, servicio, chat, llaves, safety, score, voting, ritual (`/employee/*`).

## D.6 Control de Calidad (E5 del plan)

**Estado:** ✅ Construido.

- **QC:** `AdminQCClient.tsx` — revisión de fotos post-servicio. Aprobación o rechazo con evidencia.
- **Auditoría de campo:** `field-audit-sampling.ts` — muestreo aleatorio de servicios para inspección.
- **Resolución de disputas:** `warranty-dispute-resolution.ts`, `warranty-claim-validation.ts` — evidencia fotográfica como árbitro.
- **NPS y reviews:** Formularios `/review/[token]`, `/nps/[token]`, `/survey/[token]`.
- **Testimonials:** `testimonial-collector.ts` — recolección automatizada post-servicio.

## D.7 Comunicación (E6 del plan)

**Estado:** ✅ Construido (capa completa).

**Arquitectura basada en el diagnóstico del «módulo antiguo de comunicaciones»:** El sistema no tiene amnesia, tiene esclerosis múltiple. Cada módulo (Chat, Templates, Logs) funciona, pero la solución fue crear una **plataforma de comunicación como memoria compartida**.

- **Capas:**
  - **Capa 1 (Transversal):** `communications.ts` — historial unificado. Una sola pregunta: «¿Qué le hemos dicho a este cliente, cuándo y por qué?»
  - **Capa 2 (Dominio):** `communication-model.ts`, `communication-events.ts`, `communication-preferences.ts`, `communication-attempts.ts` — modelos canónicos, eventos, preferencias, intentos.
  - **Capa 3 (Canales):** `sms.ts`, `email.ts`, `send-communication.ts` — adaptadores de canal.
  - **Capa 4 (Templates):** `template-engine.ts`, `communication-templates` (migration 352) — templates admin-editables.
  - **Capa 5 (Contexto):** `message_context` (migration 351) — cada mensaje ligado a su entidad (orden, cliente, empleado).
- **Migraciones:** 350 (attempts), 351 (context), 352 (templates), 353 (events), 354 (preferences), 360 (FKs).
- **Notificaciones:** `notification-service.ts` — unified notification dispatch.
- **Preferencias:** `communication-preferences.ts` — canal, frecuencia, horario.

## D.8 Cumplimiento Legal y PIPEDA (E7 del plan)

**Estado:** ✅ Construido.

- **Compliance Engine:** `compliance-engine.ts` — tabla `reglas_legales` con tasas: CPP 5.95%, EI 1.63%, GST 5%, PST BC 7%, WorkSafeBC 2.15%, Salario Mínimo $17.40, Vacation Pay 4%/6%, 11 Statutory Holidays BC.
- **Versionado:** `compliance-resolver.ts`, `compliance-feed.ts`, `compliance-sync.ts` — regla de oro: nunca editar versión vigente.
- **Legal Monitoring:** `legal-monitoring.ts` — feed de cambios legales (Employment Standards, WorkSafeBC, PIPEDA).
- **PIPEDA:** `pipeda.ts`, `pipa-validator.ts` — validación de lenguaje, retención, consentimiento.
- **Labor Compliance:** `cumplimiento-laboral` — panel admin de cumplimiento.
- **Contract Reviews:** `contract-review.ts` — revisión de contratos.
- **PIPEDA RLS:** Migraciones 345-348 — políticas de acceso y borrado.
- **Security audit:** Migraciones 360-364 — FKs, REVOKE EXECUTE, RLS hardening, sentinel.

## D.9 Financial Core (E8 del plan)

**Estado:** ✅ Construido (9 capas, ~54,800 líneas, 31 agentes, 129 archivos).

### Capa 0: Financial Ledger — Partida Doble
- `financial-ledger.ts` — Tabla `financial_ledger`. Cada transacción genera mínimo 2 filas (debito/crédito) con mismo `ledger_id`. Trigger SQL que valida `SUM(debitos) = SUM(creditos)`. Hash SHA-256 en cada fila.
- `shadow-ledger.ts` — Shadow ledger para reconciliación.
- `events.ts` — 20+ eventos canónicos con schemas Zod.

### Capa 1: Chart of Accounts (COA) — GAAP Canadiense
- `coa.ts` — 50+ cuentas: 1000 Activos, 2000 Pasivos, 3000 Patrimonio, 4000 Ingresos, 5000 Costos Directos, 6000 Gastos Operativos, 7000 Otros.
- `coa-imputation.ts` — Reglas de imputación por tipo de evento.
- `coa-version.ts` — Versionado de COA.

### Capa 2: Compliance Engine
- Ver D.8.

### Capa 3: Accounting Period Engine
- `accounting-period.ts` — Estados: ABIERTO → BLOQUEADO → CERRADO → ARCHIVADO.
- `close-period.ts` — 7 pasos: TB → validación → P&L/BS/CF → bloqueo → snapshot SHA-256 → audit_log.
- `period-guard.ts` — Trigger SQL que rechaza INSERTs en mes cerrado.

### Capa 4: Payroll Engine — Nómina Standalone
- `payroll-engine.ts` — Ciclos: CALCULANDO → APROBADO_ADMIN → CERRADO → REMESAS_ENVIADAS → PAGADO.
- `payroll-calculator.ts` — Day Rates + comisiones + horas extra → CPP/EI/Tax/Vacation/WorkSafeBC.
- `payroll-line.ts`, `payroll-cycle.ts`, `payroll-deductions.ts`, `payroll-bridge.ts`.
- `payroll-remittance.ts` — PD7A, resumen de remesas.
- `payroll-ytd.ts`, `payroll-ytd-dashboard.ts` — YTD acumulados, proyección, T4 preview.
- `pay-statement.ts`, `pay-statement-pdf.ts` — Pay stubs en formato BC estándar.

### Capa 5: Tax Engine — GST/PST + NETFILE
- `tax-engine.ts` — GST neto, PST neto.
- `tax-netfile.ts` — XML CRA, validación XSD, PDF.
- `tax-filing.ts` — Deadlines, frecuencia, recordatorios.
- `tax-xsd-validator.ts` — Validación de GST, T4, T4A, ROE.
- `tax-edge-cases.ts` — BN, SIN, ROE codes.
- `tax-submission-log.ts` — Historial de envíos.

### Capa 6: Documentos Oficiales — T4/T4A/ROE
- `t4-generator.ts` — T4 slips (boxes 14-46 CRA), T4 XML.
- `t4a-generator.ts` — T4A slips (boxes 020, 048).
- `roe-generator.ts` — ROE (53 boxes Service Canada).
- `t4-submission.ts`, `roe-submission.ts`.

### Capa 7: AR B2B + Bank Reconciliation
- `ar-b2b.ts` — Facturas, aging report, dunning flow (31-45-60-90 días).
- `bank-reconciliation.ts` — CSV parsing (RBC/TD/BMO), sugerencias de match.

### Capa 8: Reporting Engine — Estados Financieros GAAP
- `financial-reports.ts` — Trial Balance, P&L, Balance Sheet, Cash Flow.
- `report-formatter.ts` — Markdown, JSON.
- Vistas SQL materializadas.
- **Diferenciador:** P&L por zona, por equipo, por tipo de servicio.

### Capa 9: Accounting Adapter — Export, Nunca Import
- `accounting-adapter.ts` — Interfaz común.
- CSV, IIF (QuickBooks), PDF, CRA adapters.
- `export-service.ts`, `export-scheduler.ts`.
- **Regla de oro:** El sistema NUNCA lee de QBO/Xero. Solo exporta.

### Interconexiones Transversales (42 archivos)
- Despacho ↔ Nómina, Inventario ↔ Despacho, Marketing ↔ Inventario, Clima ↔ Despacho, QC ↔ SOP, Shadow Ledger ↔ QBO, Legal ↔ Operaciones, Pricing ↔ Competencia, PWA ↔ Servidor, Empleado ↔ Emergencia, Cliente ↔ Tracking, Cliente ↔ Lealtad, Admin ↔ Control, Marketing ↔ Crecimiento, Financiero ↔ Compliance.

## D.10 Admin & Operaciones (E9 del plan)

**Estado:** ✅ Construido (65+ rutas admin).

### Dashboard Principal
12 cards según spec `dashboard-cards.md`:

| # | Inglés | Español | Tipo |
|---|--------|---------|------|
| 1 | Business Health | Salud del Negocio | KPI |
| 2 | Review Services | Revisar Servicios | Acción |
| 3 | Review Quotes | Revisar Cotizaciones | Acción |
| 4 | Review Upsells | Revisar Ventas Adicionales | Acción |
| 5 | Approve Services | Aprobar Servicios | Acción |
| 6 | Review Alerts | Revisar Alertas | Acción |
| 7 | Today's Dispatch | Despacho de Hoy | Acción |
| 8 | At-Risk Clients | Clientes en Riesgo | KPI |
| 9 | Net Margin | Margen Neto | KPI |
| 10 | Team Score | Puntuación del Equipo | KPI |
| 11 | CRA Deadlines | Vencimientos CRA | Monitoreo |
| 12 | Backup Status | Estado de Respaldos | Monitoreo |

### Módulos de navegación lateral

| Módulo | Cards incluidas |
|--------|-----------------|
| **People** | Employees, Applicants, Teams, Team Rotation, Certifications, Wellbeing, Marketing |
| **Clients** | New Clients, Segments, Candidate Pool, Campaigns, Gifts, Neighborhood |
| **Finance** | Contribution Margin, Pricing Rules, Pricing Settings, Payroll Export, Insurance, Economic Settings, Partners, Payment Success |
| **Compliance** | Labor Compliance, Privacy, Contract Renewals, Legal Updates, Incidents |
| **System** | Recovery Drills, Stress Test, Migration Closure, Experiments, Local SEO, Growth Metrics, Attribution |

### Paneles construidos (27+ componentes admin)

- `AdminDashboardClient` — Dashboard principal con métricas
- `AdminDispatchClient` — Matriz de despacho drag-and-drop
- `AdminQCClient` — Control de calidad
- `AdminServiciosClient`, `AdminServicioDetailClient` — Órdenes de servicio
- `AdminPricingRulesClient`, `AdminPricingSettingsClient` — Reglas de pricing
- `AdminPricingRulesSandboxClient` — Sandbox de simulación
- `AdminNominaClient` — Nómina
- `AdminEmpleadosClient` — Empleados
- `AdminRolesClient` — Roles y permisos
- `AdminTicketsClient` — Tickets y disputas
- `AdminUpsellsClient` — Upsells
- `AdminContabilidadClient` — Contabilidad
- `AdminWalletClient` — Billetera
- `AdminChecklistsClient` — Checklists operativos
- `ComplianceDashboard` — Panel de cumplimiento
- `TaxDashboard`, `TaxFilingModal` — Impuestos
- `PayrollRemittancePanel` — Remesas de nómina
- `ExportAccountingPanel` — Exportación contable
- `DashboardMetricsPanel` — Métricas
- `OrderCommunicationTimeline` — Timeline de comunicación
- `AutopilotModeBanner` — Banner de modo piloto automático

### Otras funcionalidades operativas

- **Inventario:** `inventory-dispatch-gate.ts`, `inventory-reorder.ts` — control de stock de químicos e insumos.
- **Vehículos:** Seguimiento de vehículos, seguro (`vehicle-insurance.ts`).
- **Equipos:** `equipment-failure.ts`, `gestión predictiva de activos`.
- **Bandeja unificada:** `unified-alerts.ts` — alertas, disputas, incidentes en un solo lugar.
- **Delegación:** `delegation-rules.ts` — reglas para asignar alertas a coordinadores.
- **Modo autopiloto:** `autopilot-mode.ts` — decisiones automatizadas con supervisión humana opcional.

## D.11 Crecimiento y Marketing (E10 del plan)

**Estado:** ✅ Construido.

- **Posicionamiento premium:** Segmento residencial high-income, $70+/hora.
- **Atribución:** `attribution.ts`, `acquisition-channel.ts` — «¿Cómo nos conociste?», CAC por canal, LTV con fórmula.
- **SEO local:** `seo-local`, `seo-content-pipeline.ts`, `gbp-checklist.ts` — Google Business Profile, blog IA desde metadata anónima.
- **Campañas estacionales:** `campaign-scheduler.ts`, `seasonal-campaigns` — 5 campañas pre-cargadas moduladas por demanda real.
- **Análisis de demanda:** `demand-signals.ts` — clima, eventos, vacaciones, polen.
- **Competidores:** `competitor-scraper.ts`, `competitor-tracking.ts`, `competitive-pricing.ts` — scraping semanal, dashboard comparativo, alertas.
- **Partners:** `partner-commissions.ts`, `partner-tax.ts` — agentes inmobiliarios (10%), property managers (5%), veterinarios ($20), constructores (15%). T4A.
- **Contenido educativo:** `blog-content.ts` — blog IA semanal con aprobación.
- **Marketing de empleado:** `employee-marketing.ts` — reels, insignias, consentimiento.
- **Detección de fuga:** `churn-detection.ts`, `client-health-score.ts` — recurrente 60 días (encuesta $20), esporádico 90 días (30% off).
- **Experimentos A/B:** `ab-experiments.ts` — precio, copy, horario. Restricciones éticas: nunca por demográfico, recurrentes protegidos, variante <20% del control.
- **Referidos:** `referral-amplifier.ts`, `referrals.ts` — programa de referidos con tracking.
- **Carrito abandonado:** `abandoned-cart-recovery.ts`.
- **Métricas:** `growth-metrics.ts` — funnel, CAC, LTV, churn, NPS.

## D.12 Continuidad, Vecindario, Sostenibilidad (E11 del plan)

**Estado:** ✅ Construido (parcial — ver gap analysis).

- **Sucesión:** `succession.ts` — 1-3 personas de confianza. Activación por inactividad (14/21 días), incapacidad, fallecimiento. Alerta de burnout (10 días sin engagement real).
- **Backup de conocimiento:** `entity-notes.ts` — notas ligadas a entidades, sugeridas por contexto.
- **Disaster Recovery:** `dr-drill.ts` — Supabase temp <1h / >24h <48h, Vercel <30min, kit de emergencia físico.
- **Vecindario:** `neighborhood.ts` — notificación a concierge, reglas de ruido, quejas, leads, acceso por tipo de edificio.
- **Sostenibilidad:** ⏸️ DIFERIDO hasta programa de compensación real contratado. Modo Eco (+$15, biodegradables, EcoLogo), huella por servicio, reporte anual.
- **Escalabilidad:** `financial-stress-scenario.ts` — escenario de estrés (ventas −30% × 3 meses), palancas en orden, regla de reserva (3 meses fijos + 1 nómina quincenal).
- **Cierre de migración legacy:** `legacy-migration` — redirect www→app, Godaddy archivo 1 mes.

## D.13 Portal del Cliente

**Estado:** ✅ Construido.

- `/portal` → redirect a `/portal/my-services`
- `/portal/my-services` — Servicios activos
- `/portal/my-properties` — Gestión de propiedades (CRUD)
- `/portal/lulu-wallet` — Billetera, balance
- `/portal/lulu-ambassador` — Programa de referidos/embajador
- `/portal/preferences` — Preferencias de comunicación, perfil
- Tracking en vivo: `live-tracking.ts` — ETA, progreso de zonas.
- Perfil público del equipo: `team-public-profile.ts` — stats anónimas, certificaciones, idiomas.
- Health report del hogar: `home-health-report.ts`.

## D.14 PWA del Empleado

**Estado:** ✅ Construido.

- `/employee` — Dashboard personal
- `/employee/checkin` — Check-in pre-servicio (checklist matutino, ánimo, clima)
- `/employee/service/[orderId]` — Ejecución del servicio
- `/employee/service/[orderId]/preparation` — Briefing pre-servicio
- `/employee/chat/[orderId]` — Chat con admin/cliente
- `/employee/keys/[orderId]` — Manejo de llaves
- `/employee/safety` — Protocolos de seguridad, SOS (`safety-abort.ts`)
- `/employee/score` — Score y ranking
- `/employee/voting` — Votación entre pares
- `/employee/ritual` — Ritual de turno (`shift-ritual.ts`)
- `/employee/breaks` — Gestión de descansos
- `/employee/sickness` — Reporte de enfermedad (`sick-leave.ts`)
- `/employee/marketing` — Reels, insignias
- `/employee/cloths` — Uniformes

---

# PARTE E: MEJORAS ADOPTADAS (de Mejoras8.3v0.2)

## E.1 Mejoras de Interconexión (Parte B del anexo)

| ID | Mejora | Estado |
|----|--------|--------|
| B.1 | Health Check de Usuario (Employee Personal Metrics) | ✅ `employee-personal-metrics.ts` |
| B.2 | Centro de Transparencia (tracking en vivo para cliente) | ✅ `live-tracking.ts` |
| B.3 | Perfil Público del Equipo (stats pre-reserva) | ✅ `team-public-profile.ts` |
| B.4 | Encuesta de Fricción Post-Servicio | ✅ `client-friction-score.ts` |
| B.5 | Health Score del Cliente (predictivo, no reactivo) | ✅ `client-health-score.ts` |
| B.6 | Nota de Cuidado (toque humano post-servicio) | ✅ `service-briefing.ts` |
| B.7 | Calculadora de Valor del Tiempo | ✅ `time-value-calculator.ts` |
| B.8 | Garantía con Evidencia (visible para cliente) | ✅ `warranty-visibility.ts` |
| B.9 | Protocolo de Staging Fail | ✅ `warranty-claim-validation.ts` |
| B.10 | Programa de Lealtad Modular (insignias, repeat, ambassador) | ✅ `loyalty-program.ts`, `badges.ts` |
| B.11 | Marketplace de Turnos | ✅ `turn-marketplace.ts` |
| B.12 | Chat de Captura (árbol de decisión, no LLM) | ✅ `communications.ts` (widget 3 preguntas) |
| B.13 | Panel de Salud del Sistema (6 semáforos) | ✅ `system-health-panel.ts` |
| B.14 | Simulador de Escenarios (admin, sin BI) | ✅ `scenario-simulator.ts` |
| B.15 | Modo Coordinador Integrado (phone booking) | ✅ `phone-booking` |
| B.16 | Proyección Financiera del Empleado (PWA) | ✅ `payroll-ytd-dashboard.ts`, `employee-financial-dashboard.ts` |
| B.17 | Notas de Voz en PWA | ⏸️ Requiere consentimiento (B.24) |
| B.18 | Delegación Automática de Alertas | ✅ `delegation-rules.ts` |
| B.19 | Cash Flow Predictivo (30 días) | ✅ `cash-flow-predictive.ts` |
| B.20 | Landing Pages Dinámicas por Zona | ✅ `seo-content-pipeline.ts` |
| B.21 | Referidos B2B (portal property managers) | ✅ `partner-commissions.ts` |
| B.22 | Gestión Predictiva de Activos (horas de uso) | ✅ `equipment-failure.ts` |
| B.23 | Schema Registry + Health Check Unificado | ✅ `events.ts` (schemas Zod), `observability.ts` |
| B.24 | Consentimiento de Voz y Grabación | ⏸️ Requiere implementación de UI de consentimiento |
| B.25 | Calidad del Aire (PM2.5/VOCs) | ⏸️ DIFERIDO |
| B.26 | CRA Remittances → CRA Deadlines | ✅ `cra-remittances.ts` |
| B.27 | Live Portfolio → Candidate Pool | ✅ `live-portfolio.ts` |
| B.28 | QC Wall → Approve Services | ✅ `AdminQCClient.tsx` |
| B.29 | DR Drills → Recovery Drills | ✅ `dr-drill.ts` |
| B.30 | 12 Dashboard Cards (nomenclatura final) | ✅ `dashboard-cards.md` |

## E.2 Mejoras Rechazadas (documentadas para no reconsiderar)

| ID | Mejora | Razón del rechazo |
|----|--------|-------------------|
| C.9 | Chatbot LLM en Website | Alucinaciones (riesgo legal: gas cloro). Alternativa: B.29 (árbol de decisión). |
| C.10 | Realidad Aumentada (AR) para Staging | Requiere app nativa. Staging fail se resuelve con foto. |
| C.11 | Wearables para Empleados | Complejidad innecesaria. PWA en el teléfono ya cubre todo. |
| C.12 | Blockchain para Auditoría | SHA-256 en PostgreSQL ya es suficiente. |
| C.13 | Integración Directa QBO Bidireccional | Solo export. Nunca import. |
| C.14 | App Nativa (iOS/Android) | PWA es suficiente. |
| C.15 | Microservicios/Kubernetes | Monolito modular en Next.js + Supabase es correcto para la escala actual. |
| C.16 | IA para Pricing Automático | Las reglas IF/THEN + simulador son más auditables y seguras. |

---

# PARTE F: LANDING PAGE v8.5 (especificación completa integrada)

Ver spec completa en `docs/spec-v8.5-landing-final.md`. Esta sección es el resumen integrado.

## F.1 Fundamento

| # | Hecho | Consecuencia |
|---|-------|-------------|
| 0 | Cero fotos en lanzamiento. Image slots preparados. | Slots colapsados. Sin placeholders. Admin-editable. |
| 1 | No se promete «same team». | Copy: «documented home profile» y «consistent result». |
| 2 | Precio fijo, no por hora. BC Assessment. | Hero: campo dirección + «See your price». |
| 3 | VIP por precio, no por segmento. | Un solo flujo. Sin doble CTA. |
| 4 | Textos admin-editables sin código. | `site_content` en Supabase, fallback a `messages/en.json`. |

## F.2 Principios rectores

- **Rentabilidad:** ¿Esto protege el margen o lo expone?
- **Evidencia:** ¿Respaldado con datos, fotos, o hechos?
- **Profesionalismo:** ¿Tono de igual a igual o servilismo?

## F.3 Secciones

1. **Hero:** Dirección + «See your price» (sin headline retórico).
2. **How It Works:** 4 pasos con texto plano.
3. **What's Included / What's Not:** Explícito. Biohazard = rechazo.
4. **The Difference:** Pricing pre-decidido, chemical lockout, documented profile.
5. **FAQ:** 5 preguntas. Garantía condicional a fotos.
6. **Footer:** Links legales, contacto.

## F.4 Image Slots (3)

| Slot | Ubicación | Estado |
|------|----------|--------|
| Slot 1 | Hero background | Colapsado (sin imagen) |
| Slot 2 | How It Works (after step 4) | Colapsado |
| Slot 3 | The Difference (background) | Colapsado |

## F.5 Paleta y Tipografía

- Navy #0F1B2A, Ice #E8F0F8, Wave Blue #4A90D9, Ink #1A1A2E
- Inter (UI), Playfair Display (headings)

---

# PARTE G: INFRAESTRUCTURA Y OPERACIONES

## G.1 Vercel

- **48 crons** en `vercel.json` (límite Pro: 40; Hobby: solo daily).
- Crons críticos sub-diarios:
  - `safety-abort-escalation` (cada 2 min) — SOS empleado
  - `wellbeing-chemical-reassign` (cada 5 min) — exposición química
  - `key-escalation-check` (cada 5 min) — incidente de llaves
- **Recomendación:** Plan Pro para crons sub-diarios.

## G.2 Supabase

- **305 migraciones** aplicadas/por aplicar.
- **Migraciones 360-364 pendientes de push** a producción: FKs, REVOKE EXECUTE, RLS hardening, sentinel.
- **Email template** «Confirm signup» pendiente de configurar manualmente en dashboard.

## G.3 Monitoreo

- `observability.ts` — health checks de adaptadores (Stripe, Twilio, Maps, QBO).
- `pwa-heartbeat.ts` — heartbeat de PWA a servidor.
- `system-health-panel.ts` — grid de semáforos (verde/amarillo/rojo).
- Alertas: celda roja >5 min → bandeja unificada (P1).

## G.4 Seguridad

- **Auth:** Supabase Auth (magic link + OAuth). `staff-login.ts`.
- **RBAC:** `admin-rbac.ts`, `require-client-caller.ts`, `useAdminRoles.ts`.
- **API:** `cron-auth.ts`, `api-errors.ts`.
- **Crypto:** `crypto.ts`, `crypto.server.ts` — encrypt at rest (direct deposit, keys, alarm codes).
- **RLS:** Migraciones 345-348, 355-357, 362-363.
- **Audit:** `audits` — trail inmutable.
- **Backup codes:** `backup-codes.ts`, `access-recovery.ts`.

## G.5 i18n

- **3 idiomas:** EN, ES, ZH.
- **Traducciones:** `messages/en.json`, `es.json`, `zh.json`.
- **LanguageSelector** en header.
- **Bilingüismo exacto:** Traducciones literales, no adaptaciones culturales (según dashboard-cards.md).

---

# PARTE H: GOBIERNO DEL SISTEMA

## H.1 Qué puede hacer el admin sin programador

Si existe una pantalla para hacerlo → es del admin:
- Precios, tarifa objetivo, tablas HHE
- Reglas IF/THEN, zonas y pesos
- Textos del landing (vía `site_content`)
- Flags (feature flags, modos)
- Day Rates, upsells
- Los 6 puntos humanos (fallback, revisión de disputas, aprobación de nómina, sucesión, contactos de emergencia, regalos)

## H.2 Qué requiere código (IA + revisión del dueño)

- Nuevos tipos de dato
- Cambiar Hold/Batch/Stripe
- Integrar servicios externos
- Auth/RBAC/seguridad química
- Motor de nómina (cálculos)
- Migraciones de schema

## H.3 Presupuesto

- **Ruta IA:** Costos fijos ~$8-15/mes al inicio.
- **Ruta tradicional (referencial):** $36-54K + contingencia 15-20%.
- **Gate financiero:** Verificar contra flujo de caja real antes de cada etapa.

## H.4 Piloto

5-10 clientes reales antes de continuar a toda velocidad con E6+.

---

# PARTE I: GLOSARIO

| Término | Definición |
|---------|-----------|
| **Batch Capture** | Cierre diario de autorizaciones de tarjeta (Stripe). |
| **BC Assessment** | Base de datos gubernamental con tamaño real de propiedades en BC. |
| **CRA** | Canada Revenue Agency. |
| **Day Rate** | Tarifa diaria del empleado (no por hora). |
| **HHE** | Horas-Hombre Equivalente. Unidad de capacidad. |
| **IES** | Índice Entrópico de Suciedad (1.0–4.0). |
| **JE** | Journal Entry (asiento contable de partida doble). |
| **PIPEDA** | Personal Information Protection and Electronic Documents Act (Canada). |
| **PWA** | Progressive Web App (app del empleado en el teléfono). |
| **RLS** | Row Level Security (PostgreSQL). |
| **SOP** | Standard Operating Procedure. |
| **WorkSafeBC** | Ente regulador de seguridad laboral en British Columbia. |

---

*Consolidado el 6 de Agosto, 2026. Este documento reemplaza a v8.3, Mejoras8.3v0.2, spec-v8.5-landing, FinancialCore_v0.2, dashboard-cards, y cualquier otro anexo como fuente única del sistema v8.6.*
