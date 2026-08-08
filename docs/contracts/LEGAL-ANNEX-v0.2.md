# LEGAL ANNEX v0.2 — CONTRACT ARCHITECTURE
## Lulu Island Flagship | Richmond, British Columbia
**Document type:** Legal annex for v0.2 contracts
**Version:** 0.2
**Date:** August 8, 2026
**Replaces:** `LEGAL-ANNEX-v0.1`
**Scope:** Complete act inventory, selection criteria, and contract architecture

---

## 1. PURPOSE

This document records the legal foundation for the v0.2 contract suite. It serves as:

1. **Audit trail.** Why each clause exists, which act mandates it
2. **Maintenance reference.** When `legal-monitoring.ts` detects a change, impact is traceable
3. **Onboarding.** New administrators understand the legal architecture
4. **Annex to contracts.** Referenced by all v0.2 contracts

---

## 2. METHODOLOGY

### 2.1 Source Material

The legal analysis began with 41 PDF acts. v0.1 analyzed 35 acts and selected 12. v0.2 added 6 additional acts and downscaled Environmental Management Act to a single operational line.

### 2.2 Three-Perspective Validation

v0.2 was validated from three perspectives:
1. **Company** — protection from unlimited liability, clear exclusions, employee accountability
2. **Employee** — ESA compliance, confidentiality obligations, safety protocol, fair progression
3. **Client** — BPCPA rights, warranty, privacy, trespass protections

---

## 3. ACT INVENTORY — v0.2

### 3.1 Acts Applicable to Service Agreement

| # | Act | Jurisdiction | SA Sections |
|---|---|---|---|
| 1 | Business Practices and Consumer Protection Act | BC | A.4, A.5, A.9, A.12, A.16, B-RECUR.8, B-RECUR.10 |
| 2 | Excise Tax Act | Federal | A.2, A.13 |
| 3 | Personal Information Protection Act (PIPA) | BC | A.10 |
| 4 | Interest Act | Federal | A.11 |
| 5 | Interpretation Act | Federal | A.16 |
| 6 | Trespass Act | BC | A.6 |
| 7 | Electronic Transactions Act | BC | A.15 |
| 8 | Occupiers Liability Act | BC | A.9.6 |
| 9 | Limitation Act | BC | A.10, A.12 |
| 10 | Residential Tenancy Act (s.32) | BC | A.5.5 |
| 11 | Business Corporations Act | BC | Preamble |
| 12 | Environmental Management Act | BC | Reference only (via Employment §12.3) |

### 3.2 Acts Applicable to Employment Agreement

| # | Act | Jurisdiction | EA Sections |
|---|---|---|---|
| 1 | Employment Standards Act | BC | 2, 3, 5, 6, 7, 14 |
| 2 | Human Rights Code | BC | 9 |
| 3 | Workers Compensation Act | BC | 8 |
| 4 | Personal Information Protection Act (PIPA) | BC | 10 |
| 5 | Income Tax Act | Federal | 11 |
| 6 | Interpretation Act | Federal | 18 |
| 7 | Electronic Transactions Act | BC | 17 |
| 8 | Trespass Act | BC | 12.8 |

### 3.3 Acts Referenced by Website Usage Policy

| # | Act | Jurisdiction |
|---|---|---|
| 1 | Personal Information Protection Act (PIPA) | BC |
| 2 | Electronic Transactions Act | BC |
| 3 | Business Practices and Consumer Protection Act | BC |

### 3.4 Supporting Acts (Referenced, Not Directly in Contract Text)

| # | Act | Role |
|---|---|---|
| 1 | Canada Pension Plan Act | Source deductions |
| 2 | Employment Insurance Act | Source deductions |
| 3 | Strata Property Act | Client responsibility for strata fines (SA A.14.8) |

---

## 4. CONTRACT ARCHITECTURE — v0.2

### 4.1 File Structure

docs/contracts/
├── service-agreement-v0.2-en.md       # Unified client contract
├── employment-contract-v0.2-en.md     # Employment agreement
├── website-usage-policy-v0.1-en.md    # NEW — Website terms
├── LEGAL-ANNEX-v0.2.md               # This document
│
├── service-agreement-v0.2-fr.md       # French (forthcoming)
├── employment-contract-v0.2-fr.md     # French (forthcoming)
├── website-usage-policy-v0.1-fr.md    # French (forthcoming)
│
├── client-terms-v0.1-en.md           # ARCHIVED
├── client-terms-v0.1-fr.md           # ARCHIVED
├── recurring-contract-v0.1-en.md     # ARCHIVED
├── recurring-contract-v0.1-fr.md     # ARCHIVED
├── employment-contract-v0.1-en.md    # ARCHIVED
├── employment-contract-v0.1-fr.md    # ARCHIVED
└── LEGAL-ANNEX-v0.1.md              # ARCHIVED

### 4.2 Service Agreement — Modular Design

The Service Agreement v0.2 replaces two separate contracts (client-terms + recurring-contract):

**PART A — General (applies to all):** Scope, Price, Payment (B2C + B2B invoicing), Cancellation (+ BPCPA cooling-off), Warranty (+ RTA s.32), Access (+ Trespass), Chemical Lockout, Exclusions, Liability (+ Occupiers, Vicarious, BPCPA-safe cap), Privacy (+ Employee Confidentiality A.10.7-.10.9), Late Payment, Dispute (+ Consumer Protection BC), Invoicing, On-Site Protocol, E-Signature, General Provisions (+ BPCPA acknowledgment)

**PART B — Conditional Modules:** B-ONCE (one-time), B-RECUR (recurring: IPC, auto-renewal BPCPA-compliant, pause, loyalty), B-COMM (commercial/B2B: invoicing, purchase orders)

**SCHEDULE A — Per Booking:** Specs, Zones + Tasks by service type, Add-ons, Team + Timing, Organic Load + IES, Pricing, Access, Modules applied

### 4.3 Employment Agreement — Progression Model

Pay model by level: Probation (hourly), Technician (hourly), Senior (day rate, max 8h, no overtime), Team Leader (day rate + differential)

Key additions in v0.2: Employee liability for damage (graduated: accidental/covered, gross negligence/capped, outside scope/personal), Trespass/safety protocol, Client confidentiality (reinforced, survives termination), Parking via corporate card, Annual IPC adjustment (mandatory, not discretionary)

### 4.4 Key v0.2 Additions

| Clause | Where | Purpose |
|---|---|---|
| Employee Confidentiality (A.10.7-.10.9) | Service Agreement | Client knows employees are bound; Company protected if employee breaches |
| Vicarious Liability (A.9.7) | Service Agreement | Company not liable for employee criminal/outside-scope acts |
| Billing Party vs Service Recipient | Service Agreement | Separation of payment and on-site responsibility |
| Trespass/Safety Protocol | Both contracts | Clear protocol for access revocation and unsafe situations |
| Employee Liability for Damage (§12.9) | Employment | Graduated accountability |
| Progression Model (§2) | Employment | Hourly for new, day rate for proven |
| On-Site Protocol (A.14) | Service Agreement | What's delivered, what's expected, timing |

---

## 5. CONSISTENCY VERIFICATION

### 5.1 Cross-Contract Alignment

| Topic | Service Agreement | Employment Agreement | Website Policy |
|---|---|---|---|
| Confidentiality | A.10.7 (employee bound + Company steps) | §12.6 (detailed obligations) | — |
| Vicarious Liability | A.9.7 (Company not liable outside scope) | §12.9 (employee personal liability) | — |
| Trespass | A.6.4-.6.5 (client protocol) | §12.8 (employee protocol) | — |
| Privacy | A.10 (PIPA client data) | §10 (PIPA employee data) | §10 (PIPA website data) |
| Governing Law | BC | BC | BC |
| BPCPA Rights | A.12.4, A.16.8 | — | §12.3 |
| Dispute | Internal → mediation → courts | Internal → mediation → courts | Internal → analogy to SA |

### 5.2 No Contradictions Found

All three contracts use the same governing law, cross-reference correctly, and preserve statutory rights.

---

## 6. CHANGES FROM v0.1

| Aspect | v0.1 | v0.2 |
|---|---|---|
| Client contracts | 2 separate with inheritance | 1 unified with conditional modules |
| Employment model | Single day rate for all | Progression: hourly → day rate |
| Website terms | None | Website Usage Policy |
| Acts referenced | 12 | 16 direct + 4 supporting |
| BPCPA | Absent | Fully integrated |
| Trespass | Absent | Protocol in both contracts |
| Employee damage liability | Silent | Graduated accountability |
| Employee confidentiality | In employment only | Cross-referenced in client contract |
| B2B invoicing | Not addressed | CRA-compliant invoice spec |
| On-site protocol | Not specified | Complete section in Service Agreement |

---

## 7. LIMITATIONS

1. **Drafts pending legal review.** Not reviewed by a BC-qualified lawyer. Review required before binding use.
2. **This is not legal advice.** Operational templates drafted by business owner with AI assistance.
3. **Act section numbers are best-effort.** Verify with BC legal counsel.
4. **French translations pending.** English only as of v0.2 date.

---

*Annex to v0.2 contract suite. August 8, 2026.*
