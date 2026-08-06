# v8.6 — GAP ANALYSIS: Qué se tiene y qué falta
## Lulu Island Flagship | 6 de Agosto, 2026

---

# RESUMEN EJECUTIVO

**El sistema está construido en un ~90-95%.** De las 12 etapas del plan v8.3, 10 están completas (E0-E9 completo, E10 casi completo) y E11 está parcial. Las ~30 mejoras del anexo Mejoras8.3v0.2 están adoptadas en su mayoría, con 3 pendientes/diferidas y 8 explícitamente rechazadas.

Lo que **realmente falta** cae en 4 categorías:
1. **Acciones manuales** (3 ítems: push de migraciones, email template, plan Vercel)
2. **Funcionalidades diferidas** (4 ítems: eco, calidad de aire, B2B, voice consent)
3. **Refinamientos pendientes** (7 ítems: wireframes, pilot, tests, docs)
4. **Lo que emergió y no estaba en ningún plan** (positivo: ~30 módulos adicionales)

---

# PARTE A: ETAPA POR ETAPA

## E0 — Fundación y Setup

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Next.js 14 App Router | ✅ | — |
| Supabase (PostgreSQL + Auth + Storage) | ✅ | — |
| Tailwind CSS + shadcn/ui | ✅ | — |
| Auth: magic link + OAuth | ✅ | — |
| RBAC (roles: admin, supervisor, empleado, cliente) | ✅ `admin-rbac.ts`, `useAdminRoles.ts` | — |
| i18n (EN, ES, ZH) | ✅ 3 archivos de traducción, LanguageSelector | — |
| Middleware (auth, locale, redirects) | ✅ | — |
| CI/CD (Vercel auto-deploy) | ✅ | — |
| ESLint + TypeScript strict | ✅ | — |

**Veredicto E0:** ✅ COMPLETO.

---

## E1 — Cotizador y Pricing Engine

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Flujo 5 pasos | ✅ address → purpose → dimensions → addons → summary | — |
| BC Assessment integration | ✅ `bc-assessment.ts` | — |
| Pricing engine (tarifa base × IES × área) | ✅ `pricing.ts` | — |
| Zonas con pesos | ✅ Cocina 3.0, Baño 3.0, etc. | — |
| Carga orgánica (mascotas, residentes) | ✅ | — |
| Upsells pre-cargados | ✅ nevera, horno, ventanas, gabinetes | — |
| Pricing sandbox | ✅ `/admin/pricing-rules/sandbox` | — |
| Competitor price scraping (E1 checklist) | ✅ `competitor-scraper.ts` | — |
| Coeficiente de densidad (Critica V3) | ✅ Implementado | — |
| Nivel 5 (biohazard) = rechazo | ✅ | — |
| Pricing rules admin | ✅ `AdminPricingRulesClient.tsx` | — |
| Cotización >4,000 sq ft → assessment personalizado | ✅ | — |

**Veredicto E1:** ✅ COMPLETO.

---

## E2 — Reserva, Pagos, Hold/Batch

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Booking flow | ✅ `/booking/[quoteId]` | — |
| Stripe integration | ✅ `stripe.ts`, `stripe-client.ts` | — |
| Hold + Batch Capture | ✅ `batch-capture-eligibility.ts`, `batch-capture-partial.ts` | — |
| Payment reconciliation | ✅ `payment-capture-reconciliation.ts` | — |
| Política de cancelación (48h) | ✅ `order-cancellation.ts` | — |
| Garantía condicional a fotos | ✅ `warranty-visibility.ts`, `warranty-dispute-resolution.ts` | — |
| Hold expiration + grace period | ✅ `grace-period.ts` | — |
| Installment payments | ✅ `installment-payment.ts` | — |
| PayPal backup | ✅ `paypal.ts` | — |

**Veredicto E2:** ✅ COMPLETO.

---

## E3 — Capacidad y Despacho

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Employee onboarding | ✅ `employee-onboarding.ts` | — |
| Formación de equipos (líder obligatorio) | ✅ `dispatch-team.ts` | — |
| Modelo 70/30 | ✅ `schedule-7030.ts` | — |
| Cálculo de HHE y capacidad real | ✅ `hhe-adjustment.ts`, `hhe-sqft-band.ts` | — |
| Matriz drag-and-drop despacho | ✅ `AdminDispatchClient.tsx` | — |
| GPS/ETA live tracking | ✅ `live-tracking.ts` | — |
| No-show + reasignación | ✅ `dispatch-fallback.ts` | — |
| Phone booking (coordinador integrado) | ✅ `phone-booking` (route built) | — |
| Zonas geográficas con recargo | ✅ `zone-assignment.ts`, `zone-reparto.ts` | — |
| Simulación 12PM (capacidad − ausencias) | ✅ `scenario-simulator.ts` | — |
| 🚨 Seguros/WorkSafeBC (bloqueado en plan) | ✅ `business-insurance.ts`, `vehicle-insurance.ts` | — |

**Veredicto E3:** ✅ COMPLETO.

---

## E4 — Ejecución del Servicio

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Perfil documentado del hogar | ✅ `client-module/` | — |
| Protocolos por zona (código de colores) | ✅ SOP en PWA | — |
| Chemical lockout | ✅ `chemical-lockout.ts` | — |
| Kitchen timer (superficies calientes) | ✅ `kitchen-timer.ts` | — |
| Fotos timestamped de cierre | ✅ En PWA | — |
| PWA empleado (check-in, servicio, chat) | ✅ 14 routes bajo `/employee` | — |
| Inventario (químicos, insumos) | ✅ `inventory-dispatch-gate.ts`, `inventory-reorder.ts` | — |
| Manejo de llaves | ✅ `key-handling.ts` | — |
| SOS / safety abort | ✅ `safety-abort.ts`, `emergency-response.ts` | — |
| Briefing pre-servicio | ✅ `service-briefing.ts` | — |
| Ritual de turno | ✅ `shift-ritual.ts` | — |
| Wellbeing + biomechanical index | ✅ `wellbeing.ts`, `biomechanical-index.ts` (referenced) | — |
| Workplace incident reporting | ✅ `workplace-incident.ts` | — |
| Offline mode (PWA) | ✅ `offline-queue.ts`, `offline-sync-client.ts`, `offline-day-cache.ts` | — |

**Veredicto E4:** ✅ COMPLETO.

---

## E5 — Control de Calidad, Reseñas, Encuestas

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| QC Wall (→ Approve Services) | ✅ `AdminQCClient.tsx` | — |
| Fotos como evidencia | ✅ | — |
| Aprobación/rechazo con evidencia | ✅ | — |
| NPS form | ✅ `/nps/[token]` | — |
| Review form | ✅ `/review/[token]` | — |
| Survey form | ✅ `/survey/[token]` | — |
| Field audit sampling | ✅ `field-audit-sampling.ts` | — |
| Dispute resolution | ✅ `warranty-dispute-resolution.ts` | — |
| Testimonial collector | ✅ `testimonial-collector.ts` | — |
| Peer voting (entre empleados) | ✅ `peer-vote-integrity.ts`, `/employee/voting` | — |
| Low score streak detection | ✅ `low-score-streak.ts` | — |
| Anti-gaming (score) | ✅ `anti-gaming.ts` | — |

**Veredicto E5:** ✅ COMPLETO.

---

## E6 — Comunicación

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| SMS (Twilio) | ✅ `sms.ts` | — |
| Email (Nodemailer) | ✅ `email.ts` | — |
| Template engine | ✅ `template-engine.ts` | — |
| Communication preferences | ✅ `communication-preferences.ts` | — |
| Communication attempts (logs) | ✅ `communication-attempts.ts` | — |
| Communication events | ✅ `communication-events.ts` | — |
| Message context (entity linking) | ✅ migration 351 | — |
| Unified communication history | ✅ `communications.ts` | — |
| Send communication (unified dispatch) | ✅ `send-communication.ts` | — |
| Notification service | ✅ `notification-service.ts` | — |
| Consentimiento de voz (B.24) | ⚠️ Reglas definidas, UI pendiente | **GAP 1** |
| Chat empleado-admin | ✅ `/employee/chat/[orderId]` | — |
| Throttling (un mensaje por semana) | ✅ `communication-preferences.ts` | — |
| PIPA validator para marketing | ✅ `pipa-validator.ts` | — |

**Veredicto E6:** ✅ CASI COMPLETO. Gap: UI de consentimiento de voz.

---

## E7 — Cumplimiento y PIPEDA

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Compliance engine | ✅ `compliance-engine.ts` | — |
| Legal monitoring feed | ✅ `legal-monitoring.ts` | — |
| PIPEDA (retención, consentimiento, acceso) | ✅ `pipeda.ts`, `pipa-validator.ts` | — |
| Labor compliance | ✅ `cumplimiento-laboral` (route) | — |
| Contract reviews | ✅ `contract-review.ts` | — |
| Privacy policy page | ✅ `/privacy` | — |
| Terms page | ✅ `/terms` | — |
| RLS policies (migrations 345-364) | ⚠️ 360-364 pendientes de push | **GAP 2** |
| Feature flags | ✅ `feature-flags.ts`, `/admin/feature-flags` | — |
| Security settings | ✅ `/admin/seguridad` | — |
| Audit trail | ✅ `/admin/audits` | — |
| Reglas legales versionadas | ✅ `compliance-resolver.ts`, `compliance-feed.ts` | — |
| Photo retention policy | ✅ `photo-retention.ts` | — |

**Veredicto E7:** ✅ CASI COMPLETO. Gap: push de migrations 360-364.

---

## E8 — Nómina y Financial Core

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Financial ledger (partida doble) | ✅ `financial-ledger.ts` | — |
| Shadow ledger | ✅ `shadow-ledger.ts` | — |
| Chart of Accounts (GAAP) | ✅ `coa.ts` (50+ cuentas) | — |
| Accounting periods | ✅ `accounting-period.ts` | — |
| Payroll engine | ✅ `payroll-engine.ts` | — |
| Payroll calculator (Day Rate → net) | ✅ `payroll-calculator.ts` | — |
| Payroll remittances (CRA) | ✅ `payroll-remittance.ts`, `cra-remittances.ts` | — |
| Pay statements (PDF) | ✅ `pay-statement.ts`, `pay-statement-pdf.ts` | — |
| Tax engine (GST/PST) | ✅ `tax-engine.ts` | — |
| NETFILE (XML CRA) | ✅ `tax-netfile.ts`, `tax-xsd-validator.ts` | — |
| T4 generator | ✅ `t4-generator.ts` | — |
| T4A generator | ✅ `t4a-generator.ts` | — |
| ROE generator | ✅ `roe-generator.ts` | — |
| Financial reports (P&L, BS, CF) | ✅ `financial-reports.ts` | — |
| Bank reconciliation | ✅ `bank-reconciliation.ts` | — |
| AR B2B | ✅ `ar-b2b.ts` | — |
| Accounting export (CSV, IIF, PDF) | ✅ `export-service.ts`, `accounting-adapter.ts` | — |
| QBO/accounting adapters | ✅ `qbo-adapter.ts`, `qbo-sync.ts` (export only) | — |
| Partner commissions + T4A | ✅ `partner-commissions.ts`, `partner-tax.ts` | — |
| Cash flow predictive | ✅ `cash-flow-predictive.ts` | — |
| Financial stress scenario | ✅ `financial-stress-scenario.ts` | — |
| Operational accounting | ✅ `operational-accounting.ts` | — |
| Events-based JE generation | ✅ `events.ts` (20+ eventos) | — |
| Contabilidad panel | ✅ `AdminContabilidadClient.tsx` | — |
| Payroll panel | ✅ `AdminNominaClient.tsx`, `PayrollRemittancePanel.tsx` | — |
| Tax dashboard | ✅ `TaxDashboard.tsx`, `TaxFilingModal.tsx` | — |
| Export panel | ✅ `ExportAccountingPanel.tsx` | — |

**Veredicto E8:** ✅ COMPLETO (9 capas, ~54,800 líneas, 31 agentes).

---

## E9 — Admin Dashboard y Operaciones

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Dashboard con 12 cards | ✅ `AdminDashboardClient.tsx` | — |
| 65+ rutas admin | ✅ Todas con page.tsx real | — |
| Employee management | ✅ `/admin/empleados` | — |
| Role management | ✅ `/admin/roles` | — |
| Service orders | ✅ `/admin/servicios` | — |
| QC | ✅ `/admin/qc` | — |
| Dispatch matrix | ✅ `/admin/dispatch` | — |
| Inventory | ✅ `/admin/inventario` | — |
| Tickets/disputes | ✅ `/admin/tickets` | — |
| Wallet | ✅ `/admin/wallet` | — |
| Payroll | ✅ `/admin/nomina` | — |
| Tax | ✅ `/admin/tax` | — |
| UPSells | ✅ `/admin/upsells` | — |
| Alerts | ✅ `/admin/alerts` | — |
| Backup management | ✅ `/admin/backups` | — |
| Command center | ✅ `command-center.ts` | — |
| System health panel | ✅ `system-health-panel.ts` | — |
| Autopilot mode | ✅ `autopilot-mode.ts` | — |
| Delegation rules | ✅ `delegation-rules.ts` | — |
| 🎨 WIREFRAME: dispatch matrix (desktop) | ⚠️ Implementado pero sin wireframe aprobado explícitamente | **GAP 3** |
| 🎨 WIREFRAME: admin dashboard layout | ⚠️ Implementado pero sin wireframe aprobado | **GAP 3** |

**Veredicto E9:** ✅ COMPLETO. Gaps: wireframes no aprobados formalmente.

---

## E10 — Crecimiento y Marketing

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Posicionamiento premium | ✅ | — |
| Atribución (CAC, LTV) | ✅ `attribution.ts`, `acquisition-channel.ts` | — |
| SEO local | ✅ `seo-local`, `seo-content-pipeline.ts` | — |
| Google Business Profile | ✅ `gbp-checklist.ts` | — |
| Campañas estacionales (5) | ✅ `campaign-scheduler.ts` | — |
| Análisis de demanda (clima, eventos) | ✅ `demand-signals.ts` | — |
| Competitor scraping | ✅ `competitor-scraper.ts`, `competitor-tracking.ts` | — |
| Partners (4 tipos) | ✅ `partner-commissions.ts` | — |
| Contenido educativo (blog IA) | ✅ `blog-content.ts` | — |
| Marketing de empleado | ✅ `employee-marketing.ts` | — |
| Detección de fuga | ✅ `churn-detection.ts`, `client-health-score.ts` | — |
| Experimentos A/B | ✅ `ab-experiments.ts` | — |
| Referral amplifier | ✅ `referral-amplifier.ts` | — |
| Abandoned cart recovery | ✅ `abandoned-cart-recovery.ts` | — |
| Campaign-inventory lock | ✅ `campaign-inventory-lock.ts` | — |
| Growth metrics | ✅ `growth-metrics.ts` | — |
| Client segmentation | ✅ `client-segmentation.ts` | — |
| Client scoring | ✅ `client-scoring.ts` | — |
| ⏸️ B2B (diferido hasta 5+ clientes B2B) | ⏸️ No construido (correcto: diferido) | **DIFERIDO** |
| Métricas: funnel >15%, CAC < LTV/3, churn <10% | ✅ Tracking implementado | Datos reales pendientes del piloto |

**Veredicto E10:** ✅ COMPLETO (con B2B correctamente diferido).

---

## E11 — Continuidad, Vecindario, Sostenibilidad

| Planeado en v8.3 | Construido | Gap |
|---|---|---|
| Sucesión (1-3 personas) | ✅ `succession.ts` | — |
| Alerta de burnout | ✅ En `succession.ts` | — |
| Backup de conocimiento operativo | ✅ `entity-notes.ts` | — |
| Disaster recovery declarado | ✅ `dr-drill.ts` | — |
| Kit de emergencia físico | ❌ No se evidencia | **GAP 4** |
| Pruebas periódicas (backup, sucesión) | ❌ Programadas en código pero no ejecutadas | **GAP 4** |
| Vecindario (concierge, ruido, quejas) | ✅ `neighborhood.ts` | — |
| ⏸️ Sostenibilidad / Modo Eco | ⏸️ Diferido (requiere programa de compensación real) | **DIFERIDO** |
| Escalabilidad (Redis→NATS) | ⏸️ No necesario a escala actual | **DIFERIDO** |
| Escenario de estrés financiero | ✅ `financial-stress-scenario.ts` | — |
| Cierre de migración legacy | ⚠️ `legacy-migration` route existe, redirects por verificar | **GAP 5** |

**Veredicto E11:** ⚠️ PARCIAL. 2 diferidos (correctos), 2 gaps menores (kit físico, pruebas), 1 por verificar (legacy).

---

# PARTE B: MEJORAS ADOPTADAS — ESTADO

| ID | Mejora | Estado |
|----|--------|--------|
| B.1–B.16 | Interconexiones core | ✅ Todas implementadas |
| B.17 | Notas de Voz en PWA | ⏸️ Requiere consentimiento UI (B.24) |
| B.18–B.23 | Delegación, cash flow, SEO, schema registry | ✅ Todas implementadas |
| B.24 | Consentimiento de Voz (PIPEDA/CRTC) | ⚠️ Reglas definidas, UI pendiente |
| B.25 | Calidad del Aire (PM2.5/VOCs) | ⏸️ DIFERIDO |
| B.26–B.30 | Nomenclatura dashboard, CRA Deadlines, etc. | ✅ Todas implementadas |

---

# PARTE C: GAPS CRÍTICOS (requieren acción)

## 🔴 Críticos (bloquean operación o seguridad)

| # | Gap | Impacto | Acción |
|---|-----|---------|--------|
| **GAP 2** | Migraciones 360-364 no están en producción | FK constraints, RLS, sentinel no aplicados. Riesgo de seguridad. | `supabase db push` (ver POST-DEPLOY) |
| **GAP 6** | Email template «Confirm signup» no configurado | **Clientes nuevos no pueden loguearse por email.** | Manual en Supabase Dashboard (ver PENDIENTES-PARA-TI.md) |
| **GAP 7** | Vercel plan Hobby → 48 crons, solo corren daily | SOS empleado (cada 2 min) y otros crons de seguridad NO CORREN sub-daily | Verificar plan Vercel; upgradear a Pro si es Hobby |

## 🟡 Importantes (funcionalidad incompleta)

| # | Gap | Impacto | Acción |
|---|-----|---------|--------|
| **GAP 1** | UI de consentimiento de voz | Notas de voz en PWA no se pueden usar legalmente sin consentimiento explícito | Implementar pantalla de consentimiento en onboarding PWA |
| **GAP 3** | Wireframes no aprobados formalmente | Dispatch matrix y dashboard se construyeron sin wireframe previo (plan requería 🎨 WIREFRAME PRIMERO) | Validar con dueño si el diseño actual es aceptable |
| **GAP 5** | Cierre de migración legacy sin verificar | Redirect www→app, Godaddy archivo 1 mes | Verificar y ejecutar |

## 🟢 Menores (mejoras o verificación)

| # | Gap | Impacto | Acción |
|---|-----|---------|--------|
| **GAP 4** | Kit físico de emergencia no creado | Sin DR físico, solo digital | Crear sobre sellado con credenciales, deploy, arquitectura, contactos |
| **GAP 4** | Pruebas periódicas no ejecutadas | Restauración de backup, simulacro de sucesión no probados en staging | Programar y ejecutar |
| **GAP 8** | Piloto (5-10 clientes reales) no ejecutado | Plan v8.3 requería piloto al completar E5, antes de continuar E6+ | Priorizar piloto antes de más construcción |

---

# PARTE D: LO QUE SE CONSTRUYÓ QUE NO ESTABA EN NINGÚN PLAN

Esto es positivo — módulos que emergieron durante la construcción:

| Módulo | Archivos | Valor |
|--------|----------|-------|
| **Rest documentation** | `rest-documentation.ts` | API auto-documentada |
| **Bulk operations** | `bulk-operations.ts` | Operaciones masivas para admin |
| **Closure protocol** | `closure-protocol.ts` | Protocolo de cierre de empresa (escenario extremo) |
| **A11y audit** | `a11y-audit.ts`, `a11y-audit-baseline.json` | Auditoría de accesibilidad |
| **Observability** | `observability.ts` | Monitoreo unificado |
| **Format utilities** | `format.ts` | Formateo consistente |
| **Validation** | `validation.ts` | Validación cross-module |
| **API errors** | `api-errors.ts` | Manejo estandarizado de errores |
| **Request IP** | `request-ip.ts` | Geo/IP utilities |
| **Safe redirect** | `safe-redirect.ts` | Redirect seguro (anti open-redirect) |
| **Crypto server** | `crypto.server.ts` | Cifrado server-side (complementa `crypto.ts`) |
| **Supabase mappers** | `supabase-mappers.ts` | Mapeo de tipos Supabase |
| **Client visible columns** | `client-visible-columns.ts` | Control de qué columnas ve cada rol |
| **Admin auth users** | `admin-auth-users.ts` | Gestión de usuarios auth desde admin |
| **Backup storage** | `backup-storage.ts` | Almacenamiento de backups |
| **Backup jobs** | `backup-jobs.ts` | Jobs programados de backup |
| **Hiring flow** | `hiring-flow/` (directorio) | Flujo de contratación |
| **E-signature provider** | `esignature-provider.ts` | Proveedor de firma electrónica |
| **Contract IPC adjustment** | `contract-ipc-adjustment.ts` | Ajuste de contratos por inflación |
| **Weather provider** | `weather-provider.ts`, `weather-exception.ts` | Proveedor de clima + excepciones |
| **Traffic conditions** | `traffic-conditions-provider.ts` | Condiciones de tráfico para ETA |
| **Google Places** | `google-places.ts` | Integración Google Places API |
| **Geocode** | `geocode.ts` | Geocodificación |
| **Image compress** | `image-compress.ts` | Compresión de imágenes |
| **Shift rest** | `shift-rest.ts` | Descansos entre turnos |
| **Workday** | `workday.ts` | Jornada laboral |
| **Sick leave** | `sick-leave.ts` | Gestión de enfermedad |
| **Statutory holidays** | `statutory-holidays.ts` | Feriados BC |
| **Employee languages** | `employee-languages.ts` | Idiomas de empleados |
| **Languages** | `languages.ts` | Catálogo de idiomas |
| **Career path** | `career-path.ts` | Ruta de carrera |
| **Referrals** | `referrals.ts` | Tracking de referidos |
| **Purchase order escalation** | `purchase-order-escalation.ts` | Escalamiento de órdenes de compra |
| **Config history** | `/admin/config-history` | Historial de configuración |
| **Route shortcuts** | `/admin/route-shortcuts` | Optimización de rutas |

---

# PARTE E: ACCIONES PENDIENTES (checklist para el dueño)

## Inmediatas (hoy/esta semana)

- [ ] **Push migrations 360-364:** `cd supabase && supabase db push` (NUNCA `db reset` en prod)
- [ ] **Configurar email template «Confirm signup»** en Supabase Dashboard (ver `PENDIENTES-PARA-TI.md`)
- [ ] **Verificar plan Vercel:** Si es Hobby → upgradear a Pro (crons sub-diarios no corren en Hobby)
- [ ] **Git push:** Si hay commits locales sin push → `git push origin main`

## Corto plazo (1-2 semanas)

- [ ] **UI de consentimiento de voz** en onboarding PWA
- [ ] **Validar wireframes** de dispatch matrix y dashboard con el dueño
- [ ] **Verificar cierre de migración legacy** (redirect www→app)
- [ ] **Crear kit físico de emergencia** (sobre sellado)
- [ ] **Ejecutar piloto** con 5-10 clientes reales

## Mediano plazo (1-3 meses)

- [ ] **Programa de compensación de carbono** contratado → activar Modo Eco
- [ ] **5+ clientes B2B** → activar rama B2B
- [ ] **Pruebas de DR** (restauración de backup, simulacro de sucesión)
- [ ] **Validar nomenclatura con usuarios finales:** «Upsell» vs «Cross-sell», «Team» vs «Crew», «Candidate Pool» vs «Talent Pool»

---

# PARTE F: MÉTRICAS DEL SISTEMA

| Métrica | Valor |
|---------|-------|
| **Rutas totales** | ~175 (85 públicas + 65 admin + 14 empleado + 10 cuenta) |
| **Archivos en src/lib/** | 230+ |
| **Migraciones Supabase** | 305 |
| **Migraciones pendientes de push** | 5 (360-364) |
| **Componentes admin** | 27+ |
| **Líneas Financial Core** | ~54,800 |
| **Idiomas** | 3 (EN, ES, ZH) |
| **Vercel crons** | 48 (límite Pro: 40 — requiere plan Pro) |
| **Etapas completas (de 12)** | 10 completas, 2 parciales |
| **Mejoras adoptadas (de ~30)** | 27 adoptadas, 2 pendientes, 1 diferida |
| **Mejoras rechazadas** | 8 (documentadas para no reconsiderar) |
| **Gaps críticos** | 3 |
| **Gaps importantes** | 3 |
| **Gaps menores** | 3 |

---

*Documento generado el 6 de Agosto, 2026. Debe actualizarse después de cada ciclo de construcción.*
