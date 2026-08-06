# Docs & Config Inventory
## Lulu Island Flagship | v8.6 Context
**Generated:** 2026-08-06 | **Agent:** scout (Codewhale Fleet)

---

## 1. Active Documents (docs/)

| File | Purpose | Date |
|------|---------|------|
| `FinancialCore_v0.2.md` | Financial Core — 9-layer architecture, double-entry ledger, 31 agents, ~54,800 lines | 2026-08-05 |
| `NETFILE_INTEGRATION.md` | CRA GST/HST electronic filing — T619 XML, CRA sandbox, certification steps | 2026-08-05 |
| `CREDENTIALS_MAP.md` | Credential reference — Supabase ref, Stripe keys, Vercel ID, GitHub repo | 2026-08-04 |
| `POST-DEPLOY-2026-08-06.md` | Post-deploy checklist — migrations 360-364, email templates, Vercel cron limit | 2026-08-06 |
| `spec-v8.5-landing-final.md` | Landing page definitive spec (601 lines) — zero photos, image slots, BC Assessment | 2026-08-05 |
| `spec-v8.4-landing-vip-analysis.md` | 6 external AI POVs synthesis — superseded by v8.5 | 2026-08-05 |
| `eslint-report.md` | ESLint snapshot — 8 errors, 65 warnings | 2026-08-05 |
| `Mejoras8.3v0.2.md` | Gap/interconnection analysis (546 lines) | 2026-08-04 |
| `Mejoras8.3v0.1.md` | Architectural annex v0.1 (662 lines) — 13 adopted + 8 rejected improvements | 2026-08-04 |

### docs/vigente/ (Current)
| File | Purpose | Date |
|------|---------|------|
| `v8.3_PLAN_DE_CONSTRUCCION.md` | Master construction plan v8.3 | 2026-07-08 |
| `INFORME_AUDITORIA_GO_LIVE_2026-07-20.md` | Go-live audit | 2026-07-20 |
| `INFORME_AUDITORIA_IMPLACABLE_2026-07-20b.md` | Second audit pass | 2026-07-20 |
| `INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md` | Business logic & roles audit | 2026-07-21 |
| `PENDIENTES_CONSOLIDADOS.md` | Consolidated pending items | — |
| `REVISION_PLAN_v0.1_VS_CODIGO_2026-08-02.md` | Plan vs code review | 2026-08-02 |
| `RUNBOOK_FLAGS_GO_LIVE.md` | Feature flags runbook | — |
| `DECISIONES_PENDIENTES_2026-07-24.md` | Pending decisions | 2026-07-24 |

### docs/historico/ (Archived)
Stage audit reports (E1–E5), v8.2 consolidation, FABLE5 go-live prompts. **Relevance to v8.6: LOW** — all superseded by current audits.

---

## 2. Incoming Materials (_incoming_materials/)

| File | Type | Content Summary |
|------|------|-----------------|
| `v8.3_PLAN_DE_CONSTRUCCION.md` | Markdown (84KB) | Duplicate of `docs/vigente/` copy — master plan |
| `Mejoras8.3v0.2 (2).md` | Markdown (51KB) | Architectural annex, overlaps with `docs/Mejoras8.3v0.2.md` |
| `dashboard-cards.md` | Markdown (6KB) | 12 dashboard cards, lateral nav modules, naming decisions |
| `Critica_V3_Dignidad.md` | Markdown (7KB) | Pricing critique, IES correction, biohazard rejection |
| `Plan_Precios_Suciedad_V4.pdf` | PDF (73KB) | Pricing model v4 — PDF format |
| `docs:spec-v8.5-landing-final.md.rtf` | RTF | Pointer to `docs/spec-v8.5-landing-final.md` |
| `docs:FinancialCore_v0.2.md.rtf` | RTF | Pointer to `docs/FinancialCore_v0.2.md` |
| `vodulo antiguo de comunicaciones.rtf` | RTF (15KB) | **Original substantive content** — legacy communications module, ~240 lines |

---

## 3. Configuration Summary

### package.json
- **Framework:** Next.js 14 + React 18
- **Key deps:** @supabase/ssr, @stripe/stripe-js, tailwindcss, lucide-react, zod, date-fns, recharts
- **Scripts:** `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `audit:a11y`, `i18n:merge`

### vercel.json
- **48 crons** defined (Pro limit: 40)
- 3 safety-critical sub-daily crons: `safety-abort-escalation` (*/2min), `wellbeing-chemical-reassign` (*/5min), `key-escalation-check` (*/5min)
- **Risk:** Hobby plan drops ALL sub-daily crons

### next.config.mjs
- CSP headers, HSTS, Permissions-Policy
- i18n routing: `['en', 'zh', 'fr']`
- Image domains: Supabase storage

### tailwind.config.ts
- Design tokens from `src/design/tokens.ts`
- Palette: navy (#1E3A5F), gold accent, safety chemical colors (never mixed with brand)

### .env.example
30+ environment variables including: Supabase (URL, keys), Stripe (public/secret), Vercel, Twilio, Resend, Google Maps, BC Assessment API

---

## 4. Tests & Scripts

### Tests (`tests/` — 151 files)
Located in `tests/lib/` — unit and integration tests covering pricing engine, financial core, communications, compliance, and operations modules.

### Scripts (`scripts/`)
| Script | Purpose |
|--------|---------|
| `generate-tokens-css.ts` | Generate CSS custom properties from design tokens |
| `audit-accessibility.ts` | A11y audit automation |
| `i18n-merge.ts` | Merge translation files across locales |

---

## 5. Static Assets

### `public/` (8 files)
- `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- `manifest.json` (PWA, navy theme, standalone)
- `manifest-empleado.json` (employee PWA)
- `sw.js` (service worker)
- `robots.txt` (disallows /admin, /employee, /portal, /account, /survey, /review, /nps, /api/)

### `messages/` (3 locales)
- `en.json` (4,518 lines), `zh.json` (4,523 lines), `fr.json` (4,523 lines)
- ~3,009 keys each — parity verified

### `backups/`
- `lulu-island-flagship-backup-20260802_165931.tar.gz` (full repo, 2026-08-02)

---

## 6. Pending Actions

### Manual Steps (Owner Required)
1. **Configure Supabase email templates** — Confirm signup + Magic Link (see `PENDIENTES-PARA-TI.md`)
2. **Push Supabase migrations 360–364** — `supabase db push`
3. **Push git** — `git push origin main`

### Database Actions
4. **Verify 14 RPC functions in production** — run diagnostic SQL from `AUDITORIA-Y-ARREGLOS-2026-08-01.md` §7
5. **Migrations not pushed:** 360 (FKs), 361 (REVOKE), 362-363 (legal RLS), 364 (cents sentinel)

### Deployment Concerns
6. **Vercel cron limit:** 48 crons > 40 Pro limit → upgrade to Pro or migrate crons externally
7. **Feature flag `batch_capture_dispute_exclusion_enabled`** — default `false`, recommend ON
8. **Installment second-half capture** — never wired, requires cron decision
9. **Dual client system** — `client_profiles` + `clients` not unified
10. **CRA NETFILE certification** — pending, cannot file electronically
11. **Legal text for candidates** — required before `/empleo` data collection

### Owner Decisions Required
- Rejected candidate retention period (→ build purge cron)
- Hiring flow steps 2–5: complete or disable?
- Vercel plan upgrade (Pro required)
- Twilio/Resend provider activation
- Encrypted backup key rotation policy

---

## 7. Document Duplication

| Duplicate | Original |
|-----------|----------|
| `_incoming_materials/v8.3_PLAN_DE_CONSTRUCCION.md` | `docs/vigente/v8.3_PLAN_DE_CONSTRUCCION.md` |
| `_incoming_materials/Mejoras8.3v0.2 (2).md` | `docs/Mejoras8.3v0.2.md` |
| `_incoming_materials/docs:spec-v8.5-landing-final.md.rtf` | `docs/spec-v8.5-landing-final.md` |
| `_incoming_materials/docs:FinancialCore_v0.2.md.rtf` | `docs/FinancialCore_v0.2.md` |
| `vodulo antiguo de comunicaciones.rtf` | **ORIGINAL** — no duplicate found |

---

*Report compiled from ~50 documents, 6 config files, 151 test files, 3 scripts, 8 static assets. ~165 lines.*
