# Backend Inventory — Supabase Architecture
## Lulu Island Flagship | v8.6 Context
**Generated:** 2026-08-06 | **Agent:** scout (Codewhale Fleet)

---

## 1. Migration Summary

- **Total migrations:** ~190+ files, numbered 001–364 (with gaps)
- **Highest:** 364 (`cents_conversion_sentinel_guard`)
- **Major schema areas covered:**
  - Auth & RBAC (001–128)
  - Quotes & Pricing (cotizador engine)
  - Orders & Dispatch
  - Employee management & Payroll
  - Client profiles & CRM
  - Financial Core (double-entry ledger)
  - Communication layer (templates, events, attempts)
  - Legal monitoring
  - Compliance (PIPEDA, labor)
  - Landing page (site_content, landing-images)

### Latest 5 Migrations (360–364)

| # | Name | Purpose |
|---|------|---------|
| 360 | `fix_missing_fks_communication_preferences_message_context` | Add FK constraints on `communication_preferences.user_id` and `message_context.linked_by_user_id` → `auth.users` |
| 361 | `revoke_execute_set_current_fixed_costs_from_public` | `REVOKE EXECUTE ON set_current_fixed_costs FROM PUBLIC, anon` — security hardening |
| 362 | `restrict_legal_monitoring_rls` | `legal_monitoring_*` tables — only supervisors can read |
| 363 | `restrict_reglas_legales_select` | `reglas_legales` — authenticated only sees `VIGENTE` rows |
| 364 | `cents_conversion_sentinel_guard` | Sentinel against re-execution of dollar→cents conversion |

All 360–364 are security audit fixes from the 2026-08-01 audit.

### Critical Landing Page Migrations

| # | Name | Purpose |
|---|------|---------|
| 358 | `site_content` | Key/value table: `key TEXT PRIMARY KEY`, `content JSONB`, `created_at`, `updated_at`. Admin-editable text for landing page. RLS: authenticated can read; writes enforced at API layer via `requireAdminRole()`. |
| 359 | `landing_images_bucket` | Storage bucket `landing-images` — public read, admin-only write. For v8.5 image slots. |

---

## 2. Database Architecture

### RLS Status
- **All public tables have RLS enabled** — enforced by migration 211 safety net
- Helper functions: `has_admin_role()`, `is_supervisor()` (both `SECURITY DEFINER` with `SET search_path = public`)
- Periodic RLS audits applied in migrations 210, 211, 355, 356

### Three-Tier RBAC
Via `admin_roles` table:
- `owner_admin` — full access
- `ops_coordinator` — operational access
- `qc_only` — quality control only

### Auth Configuration
- Providers: Email (OTP), Google, Apple, Phone (Twilio/MessageBird)
- Email templates: Confirm signup + Magic Link (both need manual config in Supabase Dashboard — see `PENDIENTES-PARA-TI.md`)

### Storage Buckets
| Bucket | Access | Purpose |
|--------|--------|---------|
| `landing-images` | Public read, admin write | v8.5 landing page image slots |
| `candidate-documents` | Private | Hiring documents |
| `backups` | Private, encrypted | System backups |

### Edge Functions
**None.** All server logic is in Next.js API routes (`src/app/api/`).

### Database Types
**No generated TypeScript types found** in `src/`. Types are manually defined in `src/types/`.

---

## 3. Key Tables (from recent migrations)

| Table | Purpose | RLS | Status |
|-------|---------|-----|--------|
| `site_content` | Admin-editable landing page text | ✅ | Active (v8.5) |
| `landing-images` (bucket) | Image slots for landing | ✅ | Active (v8.5) |
| `communication_preferences` | User notification settings | ✅ | Active |
| `message_context` | Message threading/linking | ✅ | Active |
| `communication_templates` | Reusable message templates | ✅ | Active |
| `communication_events` | Event log for comms | ✅ | Active |
| `communication_attempts` | Delivery attempt records | ✅ | Active |
| `legal_monitoring_*` | Legal compliance tracking | ✅ (supervisor only) | Active |
| `reglas_legales` | Legal rules registry | ✅ (VIGENTE filter) | Active |
| `client_profiles` | Legacy client data | ✅ | Legacy |
| `clients` | New client module | ✅ | Active (partial) |

---

## 4. Supabase Configuration

### Client Setup (`src/lib/supabase.ts`)
- Browser client: `createBrowserClient()` with env vars
- Server client: `createServerClient()` in `src/lib/admin.ts` with service role

### Environment Variables Needed
From `.env.example`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID`
- `SUPABASE_DB_PASSWORD`

### Local Config (`supabase/config.toml`)
- 462 lines — full local dev configuration
- `seed.sql` (490 lines) with test data and safety guard against production execution

---

## 5. Backend Gaps & Risks

### Critical
1. **API-layer-only write enforcement on `site_content`/`landing-images`**: Writes rely on `requireAdminRole()` in the API route. A missed guard = any authenticated user can edit landing page content. Should add DB-level RLS write policies.
2. **14 RPC functions unverified in production**: Functions like `release_capacity_slot`, `apply_payroll_cycle_deduction`, `receive_purchase_order`, etc. may not exist in production — one already silently failed (`set_current_fixed_costs`). Run diagnostic SQL from `AUDITORIA-Y-ARREGLOS-2026-08-01.md` §7.

### Moderate
3. **Fragile idempotency guard on cents conversion (migration 229)**: Guarded only by table COMMENT — could be stronger (e.g., a sentinel row).
4. **No generated TypeScript DB types**: Manual type definitions risk drift from actual schema.
5. **Dual client system**: `client_profiles` (legacy) + `clients` (module) not unified — architectural divergence.

### Low
6. **Possible orphan rows**: `communication_preferences`/`message_context` may have rows from pre-FK era (before migration 360).

---

## 6. Pending Backend Actions

1. **Push migrations 360–364 to production**: `supabase db push` (NEVER `db reset` in prod)
2. **Run RPC existence diagnostic** (see `AUDITORIA-Y-ARREGLOS-2026-08-01.md` §7)
3. **Configure email templates** in Supabase Dashboard (see `PENDIENTES-PARA-TI.md`)
4. **Verify RLS on `site_content` writes** — consider adding DB-level policy

---

*Report compiled from ~190 migration files, config.toml, seed.sql, and client setup. ~215 lines.*
