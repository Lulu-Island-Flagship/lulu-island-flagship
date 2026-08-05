# Informe de ESLint — Lulu Island Flagship
## Estado: 2026-08-05 al cierre de sesión

---

## Resumen

| | Cantidad |
|---|---|
| **Errores** | 8 |
| **Warnings** | 65 |
| **Archivos con issues** | ~70 |

---

## 1. ERRORES (8 en 5 archivos)

### Prioridad: arreglar primero (bloquean el build)

| # | Archivo | Línea | Error | Fix |
|---|---------|-------|-------|-----|
| 1 | `src/lib/t4-submission.ts` | 22 | `validateT4SubmissionXml` unused | Quitar del import o usar |
| 2 | `src/lib/t4-generator.ts` | 686 | `any` type | Cambiar por tipo concreto |
| 3 | `src/lib/t4-generator.ts` | 687 | `any` type | Cambiar por tipo concreto |
| 4 | `src/lib/t4-generator.ts` | 688 | `xml` unused arg | Prefijar `_xml` o quitar |
| 5 | `src/lib/roe-generator.ts` | 707 | `eid` unused arg | Prefijar `_eid` |
| 6 | `src/lib/roe-generator.ts` | 707 | `m` unused arg | Prefijar `_m` |
| 7 | `src/lib/t4a-generator.ts` | 600 | `anio` unused arg | Prefijar `_anio` |
| 8 | `src/lib/tax-filing.ts` | 408 | `periodo` unused arg | Prefijar `_periodo` |

**Cómo arreglarlos:** Edits simples con `File edit`. Para los `any`, buscar el tipo correcto (normalmente `SupabaseClient` de `@supabase/supabase-js`).

---

## 2. WARNINGS (65 en ~65 archivos)

### Categoría A — Solo añadir `t` a dependency array (mecánico, ~30 archivos)

Estos son los más fáciles. El patrón es `useCallback(async () => { ... t(...) ... }, [])` → cambiar `[]` por `[t]`. `t` viene de `useTranslations` y es estable, no causa re-renders.

**Método probado que SÍ funciona:**
```bash
perl -0777 -i -pe 's@(useCallback\(async \(\) => \{.*?\}, )(\[\]\))@${1}[t])@s' archivo.tsx
```
(o `[t, tCommon]` si el archivo usa ambas, como `audits/page.tsx`)

**Archivos en esta categoría:**
- `src/app/[locale]/admin/alerts/page.tsx`
- `src/app/[locale]/admin/attribution/page.tsx`
- `src/app/[locale]/admin/backups/page.tsx`
- `src/app/[locale]/admin/business-insurance/page.tsx`
- `src/app/[locale]/admin/certificaciones/page.tsx`
- `src/app/[locale]/admin/churn-signals/page.tsx`
- `src/app/[locale]/admin/client-segments/page.tsx`
- `src/app/[locale]/admin/comunicaciones/page.tsx`
- `src/app/[locale]/admin/contract-reviews/page.tsx`
- `src/app/[locale]/admin/dr-drill/page.tsx`
- `src/app/[locale]/admin/employee-marketing/page.tsx`
- `src/app/[locale]/admin/experiments/page.tsx`
- `src/app/[locale]/admin/growth-metrics/page.tsx`
- `src/app/[locale]/admin/live-portfolio/page.tsx`
- `src/app/[locale]/admin/marketing/page.tsx`
- `src/app/[locale]/admin/monitoreo-legal/page.tsx`
- `src/app/[locale]/admin/near-misses/page.tsx`
- `src/app/[locale]/admin/neighborhood/page.tsx`
- `src/app/[locale]/admin/parametros-economicos/page.tsx`
- `src/app/[locale]/admin/partners/page.tsx`
- `src/app/[locale]/admin/pipeda/page.tsx`
- `src/app/[locale]/admin/quotes-review/page.tsx`
- `src/app/[locale]/admin/regalos/page.tsx`
- `src/app/[locale]/admin/seasonal-campaigns/page.tsx`
- `src/app/[locale]/admin/seo-local/page.tsx`
- `src/app/[locale]/admin/sos/page.tsx`
- `src/app/[locale]/admin/succession/page.tsx`
- `src/app/[locale]/admin/teams/page.tsx`
- `src/app/[locale]/admin/vehicles/page.tsx`
- `src/app/[locale]/quote/page.tsx` (2 edits: useEffect `[]`→`[t]`, useCallback `[input]`→`[input, t]`)

---

### Categoría B — Añadir `t` a deps existentes (mecánico, ~5 archivos)

Patrón: `useEffect(() => { ... t(...) }, [algo])` → añadir `t`.

**Archivos:**
- `src/app/[locale]/account/services/[orderId]/gallery/page.tsx` — `[orderId]` → `[orderId, t]`
- `src/app/[locale]/account/services/[orderId]/invoice/InvoicePageClient.tsx` — `[orderId]` → `[orderId, t]`
- `src/app/[locale]/employee/ritual/page.tsx` — `[]` → `[t]`
- `src/components/admin/AdminWalletClient.tsx` — `[query]` → `[query, t]`
- `src/components/cuenta/DashboardClient.tsx` — `[retryKey]` → `[retryKey, tCommon]` (⚠️ usa tCommon, no t)

---

### Categoría C — `useCallback` con deps especiales (~4 archivos)

**Archivos y el fix exacto:**
- `src/app/[locale]/admin/audits/page.tsx` — `[]` → `[t, tCommon]` (usa ambas)
- `src/app/[locale]/admin/team-ranking/page.tsx` — `[weekStart]` → `[t, weekStart]`
- `src/app/[locale]/admin/feature-flags/page.tsx` — `useMemo` deps `[filtered]` → `[filtered, t]`
- `src/components/cuenta/PaymentMethodsCard.tsx` — `[]` → `[tCommon]`

---

### Categoría D — `useEffect` llama a `load()` → hay que envolver en `useCallback` (~16 archivos)

⚠️ **ESTA ES LA CATEGORÍA PELIGROSA.** NO usar script automático de brace-matching — rompe sintaxis.

**Método correcto para cada archivo (3 pasos manuales):**

1. Añadir `useCallback` al import de React
2. Cambiar `async function loadXxx() {` → `const loadXxx = useCallback(async () => {` y cerrar con `}, [t]);`
3. Cambiar `useEffect(() => { loadXxx(); }, [])` → `}, [loadXxx])`

**Archivos y sus funciones:**

| Archivo | Función a envolver | Deps del useCallback |
|---------|-------------------|---------------------|
| `src/components/admin/AdminUpsellsClient.tsx` | `loadUpsells` | `[t]` |
| `src/components/admin/AdminChecklistsClient.tsx` | `loadChecklists` | `[t]` |
| `src/components/admin/AdminEmpleadosClient.tsx` | `loadEmployees` | `[t]` |
| `src/components/admin/AdminRolesClient.tsx` | `loadRoles` | `[t]` |
| `src/components/admin/AdminServiciosClient.tsx` | `loadServices` | `[t]` |
| `src/components/admin/AdminPricingSettingsClient.tsx` | `loadSettings` + `loadHHE` | `[t]` c/u |
| `src/components/cuenta/ClientPropertiesClient.tsx` | `loadProperties` | `[t]` |
| `src/components/cuenta/CommunicationPreferencesClient.tsx` | `load` | `[t]` |
| `src/components/cuenta/MisServiciosClient.tsx` | `loadAll` | `[t]` |
| `src/components/cuenta/PerfilClient.tsx` | `load` | `[tCommon]` |
| `src/app/[locale]/account/referrals/page.tsx` | `load` | `[t]` |
| `src/app/[locale]/account/wallet/page.tsx` | `load` | `[t]` |
| `src/app/[locale]/account/services/[orderId]/tracking/page.tsx` | `load` | `[orderId, t]` |
| `src/app/[locale]/employee/cloths/page.tsx` | `load` | `[t]` |
| `src/app/[locale]/employee/sickness/page.tsx` | `load` | `[t]` |
| `src/app/[locale]/employee/voting/page.tsx` | `loadPeers` | `[t]` |
| `src/app/[locale]/admin/clients/page.tsx` | `loadClients` | `[t]` |

---

### Categoría E — Casos complejos (~4 archivos)

Requieren atención especial, no automatizables:

**`src/app/[locale]/admin/applicants/page.tsx`:**
- `loadApplicants` necesita `useCallback([t, statusFilter, page])`
- `useEffect` deps: `[statusFilter, page]` → `[loadApplicants]`

**`src/components/admin/AdminServicioDetailClient.tsx`:**
- `loadChecklist` necesita `useCallback([orderId, t])`
- `useEffect` deps: `[orderId]` → `[orderId, loadChecklist]`

**`src/app/[locale]/employee/breaks/page.tsx`:**
- `load` ya está en `useCallback`, solo falta cambiar efecto deps

**`src/app/[locale]/employee/keys/[orderId]/page.tsx`:**
- `load` necesita `useCallback([orderId])`
- `useEffect` deps: `[orderId]` → `[orderId, load]`

**`src/app/[locale]/employee/service/[orderId]/page.tsx`:** ⚠️ EL MÁS DIFÍCIL
- 3 funciones load que envolver en useCallback
- 2 `eslint-disable` comments que quitar
- 3 efectos con deps que actualizar
- Revisar el reporte del agent_8f181e26 para los detalles exactos

**`src/components/empleado/ChecklistCierre.tsx`:**
- `saveLocalSnapshot` necesita estar en deps del efecto L144
- Posiblemente necesite `useCallback`

**`src/components/admin/ExportAccountingPanel.tsx`:** ⚠️ YA PARCIALMENTE ARREGLADO
- ✅ Anchor a11y errors: arreglados (quitado `useRef` + hidden `<a>`)
- ❌ Nuevo warning: `loadHistory` debe estar en `useCallback` (efecto cascada)
  - Fix: envolver `loadHistory` en `useCallback` y añadir a deps

---

### Categoría F — `next/image` (~1 archivo)

**`src/components/cuenta/PerfilClient.tsx`:**
- Línea ~129 y ~173: reemplazar `<img>` por `<Image />` de `next/image`
- `import Image from "next/image"`
- `<Image src={...} alt={...} width={56} height={56} />`

---

## 3. ORDEN DE ATAQUE RECOMENDADO

1. **Primero: errores** (8 edits simples en 5 archivos) — 5 min
2. **Segundo: Categoría A** (perl batch, 28 archivos) — 2 min
3. **Tercero: Categoría B** (perl batch, 5 archivos) — 1 min
4. **Cuarto: Categoría C** (4 edits simples) — 3 min
5. **Quinto: Categoría D** (16 archivos, manual, ~3 edits c/u) — 30 min
6. **Sexto: Categoría E** (6 archivos complejos) — 15 min
7. **Séptimo: Categoría F** (1 archivo, reemplazar `<img>`) — 2 min

**Tiempo total estimado:** ~60 minutos

---

## 4. LECCIONES APRENDIDAS

- ✅ **Perl multilínea SÍ funciona** para cambiar `[]` → `[t]` en useCallback/useEffect. Es seguro.
- ❌ **Python con brace-matching NO funciona** para envolver funciones en useCallback. Rompe sintaxis.
- ✅ **File edit con search strings exactos SÍ funciona** para cambios puntuales.
- ✅ **File patch SÍ funciona** para cambios multilínea con contexto preciso.
- ⚠️ **Agentes en worktrees NO aplican cambios** al workspace principal. Solo sirven como consultores/revisores.
- ⚠️ `File edit` a veces devuelve resultados truncados pero el cambio SÍ se aplica. Verificar siempre con lint.
