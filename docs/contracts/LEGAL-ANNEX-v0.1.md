# LEGAL ANNEX — v8.6 CONTRACTS
## Lulu Island Flagship | Richmond, British Columbia
**Document type:** Annex to `docs/spec-v8.6-completo.md`
**Version:** 0.1
**Date:** August 6, 2026
**Scope:** Legal basis, methodology, act selection/rejection, and contract architecture for v8.6

---

## 1. PURPOSE

This document records the complete process by which the v8.6 contract templates were drafted. It serves four functions:

1. **Audit trail.** Any regulator, lawyer, or successor can trace why a clause exists, which act mandates it, and which acts were considered and deliberately set aside.
2. **Maintenance.** When legal monitoring (`legal-monitoring.ts`) detects a change in an act referenced here, the impact on each contract section is traceable.
3. **Onboarding.** A new administrator or legal reviewer can understand the contract architecture without reconstructing the process.
4. **Annex to v8.6.** This document is referenced by `spec-v8.6-completo.md` as the legal foundation for the three contract types.

---

## 2. METHODOLOGY

### 2.1 Source Material

The contract work began with **35 PDF acts** in `/Documents/Documentation/Acts/`. These were assembled by the business owner as the universe of potentially relevant legislation for a cleaning services company incorporated in British Columbia.

### 2.2 Selection Process

Each act was evaluated in two passes:

- **Pass 1 — Header extraction.** The first two pages of each PDF were extracted via `pdftotext` to verify the act's actual title, jurisdiction (federal vs. provincial), and stated purpose. No act was classified based on its filename alone.
- **Pass 2 — Scope determination.** Acts that passed the initial relevance filter were evaluated against the specific needs of:
  - Employment contracts (cleaning technicians, team leads, supervisors)
  - Client service agreements (one-time residential cleaning)
  - Recurring service agreements (annual, auto-renewing plans)

### 2.3 Decision Criteria

An act was **selected** if it directly:
- Mandates a contractual provision (e.g., ESA BC requires notice periods)
- Creates an obligation the contract must acknowledge (e.g., WorkSafeBC registration)
- Establishes rights the contract must not waive (e.g., Human Rights Code non-discrimination)
- Governs data the contract collects (e.g., PIPA BC for personal information)
- Regulates a financial term in the contract (e.g., Interest Act for late payment rates)

An act was **discarded** if it:
- Applies only to federal government institutions (e.g., federal Privacy Act)
- Regulates an unrelated industry (e.g., Insurance Companies Act governs insurers, not insureds)
- Covers a subject matter absent from the contracts (e.g., animal health, veterans' pensions)
- Is a table of contents only, not the act itself
- Is jurisdictionally inapplicable (e.g., Canada Labour Code for a provincially regulated cleaning company)

---

## 3. COMPLETE ACT INVENTORY

### 3.1 Acts Selected — Employment Contract

| # | Act | Jurisdiction | Why Selected | Contract Sections |
|---|---|---|---|---|
| 1 | Employment Standards Act BC | Provincial (BC) | Minimum wage, hours, overtime, breaks, vacation, statutory holidays, sick leave, termination notice | §2–7, §14 |
| 2 | Human Rights Code BC | Provincial (BC) | Non-discrimination in employment ads, wages, and employment | §9 |
| 3 | Workers Compensation Act BC | Provincial (BC) | Mandatory WorkSafeBC registration, OHS, incident reporting, right to refuse unsafe work | §8 |
| 4 | Personal Information Protection Act BC | Provincial (BC) | Private-sector privacy law; consent, collection, use, retention, access, correction of employee data | §10 |
| 5 | Income Tax Act | Federal | Source deductions (CPP, EI, income tax), TD1 forms, SIN collection | §11 |
| 6 | Interpretation Act | Federal | Statutory interpretation rules; computation of time, definitions | §18 |

### 3.2 Acts Selected — Client Contracts (One-Time + Recurring)

| # | Act | Jurisdiction | Why Selected | Contract Sections |
|---|---|---|---|---|
| 7 | Excise Tax Act | Federal | GST/HST on cleaning services; registration number, collection, remittance | Client §2, Recurring §2 |
| 8 | Personal Information Protection Act BC | Provincial (BC) | Private-sector privacy law for client data (address, keys, codes, photos) | Client §10, Recurring (via incorporation) |
| 9 | Interest Act | Federal | Annual rate must be expressed explicitly; default 5% rate; per diem/monthly caps | Client §11, Recurring (via incorporation) |
| 10 | Interpretation Act | Federal | Statutory interpretation; computation of time | Client §14, Recurring §10 |

### 3.3 Acts Supporting the System (Not Directly in Contract Text)

| # | Act | Role |
|---|---|---|
| 11 | Business Corporations Act BC | The Company is incorporated under this act. Referenced in party identification in all three contracts. |
| 12 | Bankruptcy and Insolvency Act | Informs force majeure and termination clauses; not cited directly but shapes the risk framework. |

---

## 4. ACTS DISCARDED — WITH REASONS

Each act below was examined (first 2+ pages extracted and read). None was discarded based on filename alone.

| # | Act | Reason for Discard |
|---|---|---|
| 1 | Privacy Act (Federal) | Applies exclusively to federal government institutions (s. 2: "personal information about themselves held by a government institution"). A private cleaning company in BC is governed by PIPA BC, not this act. |
| 2 | Canada Labour Code | Applies only to "federal work, undertaking or business" (s. 2): banks, railways, airlines, broadcasting, etc. A local BC cleaning company is provincially regulated under ESA BC. |
| 3 | Pension Act | Provides pensions for disabled veterans and their dependants (s. 2: "members of the forces who have been disabled or have died as a result of military service"). Not employment pensions. |
| 4 | Insurance Companies Act | Governs the incorporation, regulation, and corporate governance of insurance companies (1,095 pages). Does not address what insurance a cleaning business must carry. |
| 5 | Canada Business Corporations Act | Federal incorporation statute. The Company is incorporated in BC under the BC Business Corporations Act. The federal act is jurisdictionally inapplicable. |
| 6 | Canada Mortgage and Housing Corporation Act | Incorporates and governs CMHC, a federal housing agency. No relevance to cleaning contracts. |
| 7 | National Housing Act | Federal housing finance and mortgage insurance. No relevance. |
| 8 | National Housing Strategy Act | Federal policy declaration on housing. No relevance. |
| 9 | Rental Housing Benefit Act | Federal rental housing benefit program. No relevance. |
| 10 | Land Owner Transparency Act | BC land ownership registry and beneficial ownership disclosure. No relevance unless the Company purchases real property. |
| 11 | Canada Small Business Financing Act | Federal loan guarantee program (CSBFP). Relevant to financing, not to contracts. |
| 12 | Small Business Investment Grants Act | Federal interest-relief grants on small business debt (s. 3: up to 4% per annum). Relevant to financing, not to contracts. |
| 13 | Canada Revenue Agency Act | Administrative structure of the CRA. Does not create obligations for contract content; the substantive obligations are in the Income Tax Act and Excise Tax Act. |
| 14 | Income Tax Application Rules | Transitional rules from the 1971 tax reform. Not needed for current contract drafting. |
| 15 | Divorce Act | Family law. No relevance. |
| 16 | Family Law Act (TOC) | Family law. No relevance. |
| 17 | Wills, Estates and Succession Act | Estates law. No relevance. |
| 18 | Trustee Act | Trust law. No relevance. |
| 19 | Health of Animals Act | Animal health and disease control. No relevance. |
| 20 | Seized Property Management Act | Management of property seized under federal criminal law. No relevance. |
| 21 | Surplus Crown Assets Act | Disposal of surplus federal government assets. No relevance. |
| 22 | Government Corporations Operation Act | Governance of federal Crown corporations. No relevance. |
| 23 | Poverty Reduction Act | Federal social policy. No relevance. |
| 24 | Table of Contents — Business Corporations Act (Federal) | Index only. The full federal act (item 5 above) was discarded. |
| 25 | Table of Contents — Land Title Act | Index only. Land title registration is not relevant to cleaning contracts. |

---

## 5. ACTS THAT WERE MISSING AND ADDED

During the Pass 1 review, four critical BC provincial acts were identified as absent from the original collection. The business owner located and added them.

| # | Act | Date Added | Why Critical |
|---|---|---|---|
| 1 | Human Rights Code BC | Aug 6, 2026 | Non-discrimination and equal pay provisions are mandatory in BC employment contracts. |
| 2 | Personal Information Protection Act BC (PIPA) | Aug 6, 2026 | The federal Privacy Act does not apply to private businesses. PIPA BC is the operative privacy law for employee and client data. |
| 3 | Workers Compensation Act BC | Aug 6, 2026 | Mandatory WorkSafeBC registration and OHS compliance for all BC employers. |
| 4 | Business Corporations Act BC (TOC) | Aug 6, 2026 | Confirms provincial incorporation; needed for correct party identification in contracts. |

---

## 6. CONTRACT ARCHITECTURE

### 6.1 Three Contract Types

The system (`esignature-provider.ts`) defines three contract types, matching the operational reality:

```
esignature-provider.ts
├── "employment_contract"    → Employment Agreement
├── "client_terms"           → Client Service Agreement (One-Time)
└── "recurring_contract"     → Recurring Cleaning Service Agreement
```

### 6.2 Inheritance Model

The recurring contract does not duplicate the client terms. It inherits them by reference:

```
Client Service Agreement (One-Time)
    │
    │  incorporated by reference (§1.4)
    │
    ▼
Recurring Cleaning Service Agreement
    │
    │  adds:
    ├── Plan type and frequency
    ├── Priority scheduling (70/30 model)
    ├── Annual IPC adjustment
    ├── Auto-renewal with 30-day opt-out
    ├── Pause/resume
    ├── Loyalty + Ambassador benefits
    ├── Annual legal review (60-day window)
    └── Order of precedence clause
```

This design means a regulatory change to the `client_terms` (e.g., a new PIPA requirement) automatically propagates to the recurring contract without editing both documents. Only recurring-specific provisions need independent legal review.

### 6.3 Which Contract Is Signed When

| User Journey Step | Contract Triggered | Signature Method |
|---|---|---|
| Employee onboarding (PWA) | Employment Agreement | E-signature (Documenso/DocuSign, `esignature-provider.ts`) |
| Client first booking (checkout) | Client Service Agreement (One-Time) | Clickwrap (`consent_tc`, `consent_ip`, `consent_accepted_at`) |
| Client activates recurring plan | Recurring Service Agreement | Clickwrap at enrollment |
| Annual renewal with legal changes | New version of Recurring Agreement | E-signature or clickwrap (`contract-review.ts`) |
| Annual IPC adjustment only | No new contract | Notification only (no re-acceptance required) |

---

## 7. SYSTEM-TO-CONTRACT MAPPING

Every contract placeholder (`[VARIABLE]`) and every cross-reference to a system module (`module.ts`) corresponds to real, built functionality in v8.6.

### 7.1 Employment Contract — System Data Sources

| Contract Variable / Reference | v8.6 Module | Data Source |
|---|---|---|
| `[EMPLOYEE_FULL_NAME]`, `[EMPLOYEE_ADDRESS]` | `employee-onboarding.ts` | `employees` table |
| `[POSITION_TITLE]`, `[START_DATE]` | `hiring-flow/` | Position and start date from hiring pipeline |
| `[DAY_RATE]` | `payroll-engine.ts`, `payroll-calculator.ts` | Day rate from compensation rules |
| `[WORKSAFEBC_NUMBER]` | `business-insurance.ts` | WorkSafeBC registration number |
| Statutory holidays list | `statutory-holidays.ts` | BC statutory holidays with dates |
| Sick leave tracking | `sick-leave.ts` | Accrued/used sick leave balance |
| Shift rest rules | `shift-rest.ts` | Minimum hours between shifts |
| Workday configuration | `workday.ts` | Standard hours, break rules |
| Chemical lockout protocol | `chemical-lockout.ts` | Approved products, SDS references |
| Key handling protocol | `key-handling.ts` | Key tracking, access code encryption |
| Photo evidence requirement | PWA employee app | Timestamped, geotagged completion photos |
| Workplace incident reporting | `workplace-incident.ts` | Incident → supervisor → WorkSafeBC Form 7 |
| E-signature | `esignature-provider.ts` | Documenso/DocuSign integration (stub pending provider) |
| Annual IPC adjustment | `contract-ipc-adjustment.ts` | BC CPI data → day rate recalculation |
| Contract review | `contract-review.ts` | 60-day pre-anniversary legal compliance scan |

### 7.2 Client Contracts — System Data Sources

| Contract Variable / Reference | v8.6 Module | Data Source |
|---|---|---|
| `[CLIENT_FULL_NAME]`, `[CLIENT_EMAIL]`, `[CLIENT_IP]` | Auth (Supabase) | User metadata + request headers |
| `[SERVICE_ADDRESS]`, `[BC_ASSESSMENT_AREA]` | `bc-assessment.ts` | BC Assessment API → verified m² |
| `[SERVICE_TYPE]`, zone weights, IES level | `pricing.ts`, `addon-zones.ts` | Quote engine output |
| `[TOTAL_PRICE]`, `[GST_AMOUNT]` | `pricing.ts`, `tax-engine.ts` | Fixed price + GST/HST calculation |
| `[GST_NUMBER]` | `tax-engine.ts` | Company GST/HST registration |
| Payment method (Hold + Batch) | `stripe.ts`, `batch-capture-eligibility.ts` | Stripe integration |
| Installment schedule | `installment-payment.ts` | Payment splitting rules |
| Cancellation rules | `order-cancellation.ts` | 48h notice, late fee |
| Warranty terms | `warranty-visibility.ts`, `warranty-dispute-resolution.ts` | Photo evidence, QC review |
| Access methods | `key-handling.ts`, `crypto.ts` | Key/access code encryption |
| Chemical lockout | `chemical-lockout.ts` | Approved products |
| Exclusions list | Landing page "What's Not Included" | Biohazard, mould, pests, hoarding |
| Insurance coverage | `business-insurance.ts` | Liability insurance, WorkSafeBC |
| Late payment interest | — (admin-configured parameter) | `[LATE_INTEREST_RATE]` |
| Force majeure — weather | `weather-provider.ts`, `weather-exception.ts` | Severe weather detection |
| Priority scheduling (70/30) | `schedule-7030.ts` | Capacity allocation |
| Recurring plan parameters | `dispatch-team.ts` | Frequency, preferred day/time |
| IPC adjustment formula | `contract-ipc-adjustment.ts` | BC CPI → price recalculation |
| Loyalty + Ambassador | `loyalty-program.ts`, `badges.ts`, `referrals.ts` | Credits, badges, referral tracking |
| Legal review pipeline | `legal-monitoring.ts`, `legal-ops-bridge.ts` | Regulatory change detection → contract diff |

---

## 8. CONTRACT VERSIONING AND MAINTENANCE PROTOCOL

### 8.1 Version Lifecycle

```
v0.1 (current)     →  Draft. Pending BC lawyer review.
v1.0                →  First lawyer-approved version. Deployable.
v1.1, v1.2, ...     →  Minor updates (typo fixes, clarifications).
v2.0, v3.0, ...     →  Major updates (new legislation, restructured terms).
```

All versions are retained. No version is ever deleted. Previous versions are marked "superseded."

### 8.2 Trigger Events for Version Updates

| Trigger | Detection | Response |
|---|---|---|
| Legal change detected | `legal-monitoring.ts` feed scan | `legal-ops-bridge.ts` routes to affected modules; admin reviews impact on contracts |
| Anniversary approaching | `contract-review.ts` (60-day window) | Automated diff report; admin decides whether update is needed |
| Court decision affecting interpretation | Manual (admin review) | New version with updated clause language |
| Business rule change (e.g., new cancellation policy) | Manual (admin update) | New version with updated clause |

### 8.3 Acceptance Tracking

Every contract acceptance is recorded immutably with:

- Client/Employee name and email
- IP address
- Timestamp of acceptance (`consent_accepted_at`)
- Exact version identifier accepted (`consent_tc`)
- Document hash (SHA-256 via `legal-monitoring.ts` `computeRowHash`)

This audit trail is the system's evidence that a specific party accepted a specific version of a specific contract at a specific time.

---

## 9. LIMITATIONS AND DISCLAIMERS

1. **These contracts are v0.1 drafts.** They have not been reviewed by a lawyer qualified to practice in British Columbia. Section B.4 of the v8.3 plan explicitly requires this review before any contract becomes binding.

2. **This is not legal advice.** This document and the contracts it describes were drafted by the business owner with AI assistance. They are operational templates, not legal opinions.

3. **The e-signature provider is not configured.** `esignature-provider.ts` returns `status: "not_configured"` — the Documenso or DocuSign integration is pending. Clickwrap acceptance is currently the only available signature method.

4. **The 35-act collection may not be exhaustive.** Future legislation or newly discovered regulations may require additional contract provisions. The legal monitoring system (`legal-monitoring.ts`) is designed to detect such changes.

5. **BC law governs.** All contracts are governed by the laws of British Columbia and applicable federal laws of Canada. If the Company expands to other provinces, province-specific employment standards and privacy legislation must be evaluated.

---

## 10. FILE INDEX

| File | Purpose |
|---|---|
| `LEGAL-ANNEX-v0.1.md` | This document. Methodology, act inventory, architecture. |
| `employment-contract-v0.1-en.md` | Employment Agreement — English |
| `employment-contract-v0.1-fr.md` | Employment Agreement — French |
| `client-terms-v0.1-en.md` | Client Service Agreement (One-Time) — English |
| `client-terms-v0.1-fr.md` | Client Service Agreement (One-Time) — French |
| `recurring-contract-v0.1-en.md` | Recurring Service Agreement — English |
| `recurring-contract-v0.1-fr.md` | Recurring Service Agreement — French |

**Referenced from:**
- `docs/spec-v8.6-completo.md` — System specification, Part D (Modules), Part G (Infrastructure)
- `docs/gap-analysis-v8.6.md` — Gap analysis, Part C (Critical Gaps)
- `src/lib/esignature-provider.ts` — Three contract types: `employment_contract`, `client_terms`, `recurring_contract`

---

*Annex to v8.6. Consolidated August 6, 2026. Update when contract versions change or when new acts are added to the monitored set.*
