# RECURRING CLEANING SERVICE AGREEMENT
## Lulu Island Flagship | Richmond, British Columbia
**Version:** 0.1 (Draft — pending legal review by a BC-qualified lawyer)
**Date:** August 6, 2026
**Type:** `recurring_contract` (annual — auto-renews with IPC adjustment)
**Languages:** English | [Français](recurring-contract-v0.1-fr.md)

---

**IMPORTANT:** This Agreement governs an ongoing, recurring cleaning relationship. It incorporates the Company's one-time Client Service Agreement (`client_terms`) for all individual service-level provisions (scope, payment method, warranty, access, chemical lockout, exclusions, liability, privacy, late payment interest, and dispute resolution). The Client acknowledges having accepted the Client Service Agreement at the time of first booking. This Agreement adds and, where conflicting, overrides the terms specific to the recurring relationship.

---

**This Agreement** is made between:

**Service Provider:** Lulu Island Flagship Cleaning Services Inc., a corporation incorporated under the laws of British Columbia, with its registered office in Richmond, B.C. ("the Company")

**Client:** `[CLIENT_FULL_NAME]`, residing at `[CLIENT_BILLING_ADDRESS]` ("the Client")

(Collectively "the Parties")

---

## 1. RECURRING SERVICE PLAN

1.1 **Plan Type.** The Client enrolls in the following recurring cleaning plan:

| Plan Detail | Value |
|---|---|
| Service type | `[SERVICE_TYPE]` (e.g., Maintenance Clean) |
| Frequency | `[FREQUENCY]` (Weekly / Bi-Weekly / Monthly) |
| Preferred day(s) | `[PREFERRED_DAYS]` |
| Preferred time window | `[TIME_WINDOW_START]` – `[TIME_WINDOW_END]` |
| Property address | `[SERVICE_ADDRESS]`, Richmond, B.C. |
| BC Assessment area | `[BC_ASSESSMENT_AREA]` m² |

1.2 **Initial Service.** The first service under this Agreement is the deeper Initial Clean, completed on `[INITIAL_CLEAN_DATE]`. Subsequent services are Maintenance Cleans at the frequency stated above. The Initial Clean price is separate from the recurring price and was paid under the one-time Client Service Agreement.

1.3 **Zone Baseline.** The zones and add-ons included in each recurring service are the same as those selected by the Client during the original booking, as recorded in the Client's documented home profile. The Client may adjust zones or add-ons through the Client Portal at any time; changes take effect on the next scheduled service and may adjust the recurring price.

1.4 **Incorporation of Client Service Agreement.** Each individual service under this Agreement is governed by the Company's Client Service Agreement (`client_terms`) then in effect, including all provisions on: service scope, payment method (Hold + Batch Capture via Stripe), warranty (photo evidence), access to property, chemical lockout, exclusions (biohazard, mould, pests, hoarding), liability and insurance, privacy (PIPA BC), late payment interest (Interest Act), and dispute resolution. The current version of the Client Service Agreement is always available at the Company's website. In the event of any conflict between this Agreement and the Client Service Agreement, this Agreement prevails with respect to the recurring relationship terms (Sections 1–10 of this Agreement).

---

## 2. RECURRING PRICE AND ANNUAL IPC ADJUSTMENT

2.1 **Recurring Price Per Service.** The price per recurring service is **`$[RECURRING_PRICE]` CAD** (including GST/HST). This price is fixed for the first year of this Agreement.

2.2 **Annual IPC Adjustment.** On each anniversary of the Effective Date (Section 5.1), the per-service price shall be adjusted in accordance with the British Columbia Consumer Price Index (CPI), All-Items, as published by Statistics Canada for the most recent twelve (12) months for which data is available. The adjustment is calculated and applied by the Company's system (`contract-ipc-adjustment.ts`).

2.3 **Adjustment Formula.** The adjusted price is calculated as:

```
New Price = Current Price × (1 + CPI_Change%)
```

Where `CPI_Change%` is the twelve-month percentage change in the BC CPI. The adjustment shall never reduce the price below the original price at the start of the contract year.

2.4 **Adjustment Notification.** The Company shall notify the Client in writing (email or Client Portal notification) of any IPC adjustment at least thirty (30) days before the effective date. The notification shall include the new per-service price, the CPI figure used, and a link to the Statistics Canada source.

2.5 **Price Freeze During Pause.** If the Client pauses services under Section 4.3, the IPC adjustment shall be calculated as if the pause period did not exist — i.e., the adjustment is based on the calendar anniversary, not on the number of services performed.

2.6 **No Other Price Changes.** The per-service price shall not increase during any contract year except by the annual IPC adjustment in this Section, unless the Client adds zones or add-ons (Section 1.3) or materially misrepresents factors affecting pricing (per the Client Service Agreement, Sections 1.6–1.7 on organic load and IES).

---

## 3. SCHEDULING AND PRIORITY

3.1 **Priority Scheduling.** Recurring clients receive priority in the Company's scheduling system. The Company operates a 70/30 model (`schedule-7030.ts`): approximately 70% of weekly capacity is reserved for recurring clients, with the remaining 30% available for one-time bookings. Within the 70% recurring allocation, service slots are assigned in order of plan seniority, subject to geographic route optimization.

3.2 **Preferred Day and Time.** The Company shall make reasonable commercial efforts to schedule the Client's services on the preferred day(s) and time window stated in Section 1.1. The Company shall notify the Client at least forty-eight (48) hours in advance of any deviation from the preferred schedule.

3.3 **Rescheduling by Client.** The Client may reschedule any individual service without charge by providing at least forty-eight (48) hours' notice through the Client Portal. Rescheduled services are subject to availability within the same billing cycle.

3.4 **Skipping a Service.** The Client may skip up to `[MAX_SKIPS_PER_YEAR]` services per contract year without affecting plan status. Skipped services are not charged. The Client must provide at least forty-eight (48) hours' notice to skip. Beyond the allowed skips, skipped services shall be charged at fifty percent (50%) of the per-service price to reserve the Client's priority slot (see Section 4.3 for formal pause options).

3.5 **Company Rescheduling.** If the Company must reschedule a service due to a statutory holiday, severe weather (`weather-exception.ts`), or operational necessity, the Company shall notify the Client and offer the next available slot. No charge applies for Company-rescheduled services that the Client cannot accommodate.

---

## 4. TERM, RENEWAL, AND PAUSE

4.1 **Initial Term.** This Agreement begins on the Effective Date (Section 5.1) and continues for an initial term of one (1) year.

4.2 **Auto-Renewal.** This Agreement renews automatically for successive one-year terms on each anniversary of the Effective Date, unless either Party gives notice of non-renewal at least thirty (30) days before the anniversary.

4.3 **Pause.** The Client may pause all recurring services for a period of `[MIN_PAUSE_WEEKS]` to `[MAX_PAUSE_WEEKS]` weeks per contract year by providing at least seven (7) days' written notice through the Client Portal. During the pause, no services are performed, no charges are incurred, and the Client's priority slot is held. The contract anniversary is not extended by the pause period. A pause exceeding the maximum shall be treated as a termination by the Client under Section 6.2.

4.4 **Pause Reasons.** Common reasons for pausing include vacation, home renovation, or extended travel. The Client is not required to provide a reason, only the start and end dates of the pause.

4.5 **Resumption After Pause.** Upon resumption, the first service shall be treated as a standard Maintenance Clean at the then-current recurring price. If the Client paused for more than `[DEEP_CLEAN_THRESHOLD_WEEKS]` weeks, the Company may recommend (but not require) a Deep Clean at the then-current one-time rate before resuming the recurring schedule. The Client may decline this recommendation without penalty.

---

## 5. EFFECTIVE DATE AND ANNIVERSARY

5.1 **Effective Date.** This Agreement takes effect on `[EFFECTIVE_DATE]`, which is the date the Client accepted this Agreement after completing the Initial Clean and enrolling in the recurring plan.

5.2 **Anniversary.** The anniversary date for IPC adjustment (Section 2.2), contract review (Section 8), and renewal (Section 4.2) is `[ANNIVERSARY_DATE]`, which is twelve (12) months after the Effective Date and each twelve-month anniversary thereafter.

5.3 **Contract Commencement vs. Anniversary.** The Initial Clean date, the Effective Date of this Agreement, and the first anniversary may differ. Only the Effective Date governs the term, renewal, and IPC adjustment schedule.

---

## 6. TERMINATION

6.1 **Termination by the Company.** The Company may terminate this Agreement:

- **(a) Material Breach:** Immediately upon written notice if the Client commits a material breach of this Agreement or the incorporated Client Service Agreement, including but not limited to: non-payment for two (2) or more consecutive services, providing false information, creating an unsafe work environment, or harassing Company staff.
- **(b) Without Cause:** Upon thirty (30) days' written notice for any reason. The Company shall complete all services scheduled during the notice period.
- **(c) Discontinuation of Service Area:** Upon thirty (30) days' written notice if the Company discontinues operations in the Client's geographic zone. Prepaid but unperformed services shall be refunded on a pro-rata basis.

6.2 **Termination by the Client.** The Client may terminate this Agreement:

- **(a) Without Cause:** Upon thirty (30) days' written notice through the Client Portal. The Client may elect to receive or decline the services scheduled during the notice period. Declined services during the notice period are not charged and the priority slot is released.
- **(b) Price Dispute:** Within fourteen (14) days of receiving an IPC adjustment notification (Section 2.4), if the Client does not accept the adjusted price. Services scheduled before the effective date of the adjustment shall be performed at the existing price.

6.3 **Effect of Termination.** Upon termination, the Client's recurring plan status, priority scheduling, loyalty benefits, and ambassador status shall cease. The Client may continue to book one-time services under the standard Client Service Agreement. Any outstanding balance remains due. The Client's documented home profile and encrypted access information shall be retained per the Company's privacy policy (PIPA BC) unless the Client requests deletion.

6.4 **No Early Termination Fee.** The Company does not charge an early termination fee. The thirty (30) day notice period is the sole requirement for Client-initiated termination without cause.

---

## 7. LOYALTY AND AMBASSADOR BENEFITS

7.1 **Lulu Wallet.** Recurring clients automatically participate in the Lulu Wallet loyalty program (`loyalty-program.ts`). Credits accrue per completed service. Wallet credits may be applied toward add-ons, Deep Clean upgrades, or gifted services. Wallet terms (accrual rate, expiry, redemption) are published in the Client Portal and may be updated by the Company with thirty (30) days' notice.

7.2 **Badges and Milestones.** The Client earns milestone badges for service tenure (`badges.ts`). Badges are displayed in the Client Portal and may unlock periodic benefits (e.g., complimentary add-on on anniversary, priority during peak seasons).

7.3 **Lulu Ambassador Program.** After `[AMBASSADOR_QUALIFYING_SERVICES]` completed recurring services, the Client becomes eligible for the Lulu Ambassador referral program (`referrals.ts`). Ambassador benefits include: referral credits for each new client who completes a service, and enhanced Wallet earning rates. Ambassador status is contingent on maintaining an active recurring plan.

7.4 **No Cash Value.** Loyalty credits, badges, and Ambassador benefits have no cash value outside the Company's platform and are not redeemable for cash.

---

## 8. ANNUAL CONTRACT REVIEW AND LEGAL COMPLIANCE

8.1 **Automated Review Window.** Sixty (60) days before each anniversary, the Company's contract management system (`contract-review.ts`) initiates an automated review of this Agreement against any changes in applicable law detected by the legal monitoring system (`legal-monitoring.ts`). The system generates a report listing any regulatory changes that may affect the terms of this Agreement.

8.2 **Admin Review.** The Company's administrator reviews the automated report and determines whether this Agreement requires modification. If modification is required, the Company shall:

- Generate a new version of this Agreement incorporating the required changes
- Mark the previous version as "superseded" (never deleted)
- Provide the Client with a change log summarizing the differences
- Deliver the updated Agreement to the Client at least thirty (30) days before the anniversary

8.3 **Client Acceptance.** The Client shall review and accept (by electronic signature through the Client Portal or via the Company's e-signature provider, `esignature-provider.ts`) the updated Agreement. If the Client does not accept the updated Agreement within thirty (30) days of delivery, this Agreement shall not renew (Section 4.2) and shall terminate at the end of the then-current term.

8.4 **No Change Scenario.** If the automated review identifies no regulatory changes requiring modification and the Company determines no other changes are necessary, the existing Agreement shall auto-renew without action by either Party.

8.5 **IPC vs. Legal Review.** The annual IPC price adjustment (Section 2.2) and the annual legal review (this Section 8) are separate processes. An IPC adjustment alone does not require Client acceptance of a new contract version; it is effective upon notification (Section 2.4). Only contract text modifications require the process in this Section.

---

## 9. ELECTRONIC SIGNATURE AND ACCEPTANCE

9.1 **Acceptance at Enrollment.** The Client accepts this Agreement by clicking "Activate Recurring Plan" or an equivalent acceptance button during the recurring plan enrollment flow. This action constitutes an electronic signature with the same legal effect as a handwritten signature.

9.2 **Acceptance Record.** The Company records the Client's acceptance with the following metadata, stored immutably in the system: Client name, email, IP address, timestamp of acceptance, and the exact version of this Agreement accepted.

9.3 **Annual Re-Acceptance on Modification.** If the Agreement is modified under Section 8, the Client's acceptance of the new version shall be recorded with the same metadata, and the new version shall govern from the anniversary date forward. The previous version remains available in the system as a historical record.

9.4 **E-Signature Provider.** The Company uses a PIPA-compliant e-signature provider (`esignature-provider.ts`). Clickwrap acceptance is sufficient for the initial enrollment and for annual re-acceptance of non-material changes. The Company may require formal e-signature for material changes.

---

## 10. GENERAL PROVISIONS

10.1 **Entire Agreement.** This Agreement, together with the incorporated Client Service Agreement (`client_terms`), the Cancellation Policy at `/cancellation`, and the Privacy Policy at `/privacy`, constitutes the entire agreement between the Parties with respect to the recurring cleaning relationship and supersedes all prior discussions, representations, and agreements, whether written or oral.

10.2 **Order of Precedence.** In the event of any conflict between the documents comprising this Agreement, the order of precedence is: (1) this Recurring Cleaning Service Agreement, (2) the Client Service Agreement, (3) the Cancellation Policy, (4) the Privacy Policy.

10.3 **No Waiver.** The failure of either Party to enforce any provision shall not constitute a waiver of that provision or of any other provision.

10.4 **Severability.** If any provision is held invalid or unenforceable, the remaining provisions shall continue in full force and effect, and the invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable.

10.5 **Force Majeure.** Neither Party shall be liable for failure or delay in performance caused by events beyond their reasonable control, including but not limited to: natural disasters, extreme weather, pandemic, civil unrest, or government order. The affected Party shall notify the other promptly and resume performance as soon as reasonably practicable. During a force majeure event affecting the Company, the Client shall not be charged for services that cannot be performed, and the Client's priority status shall be preserved.

10.6 **Assignment.** The Client may not assign this Agreement without the Company's prior written consent. The Company may assign this Agreement to a successor entity in the event of a merger, acquisition, or sale of substantially all of its assets, provided the assignee assumes all obligations.

10.7 **Notices.** All notices under this Agreement shall be in writing. Notices to the Client shall be sent to the email address on file in the Client Portal or via Client Portal notification. Notices to the Company shall be sent via the Client Portal or to `[COMPANY_EMAIL]`. Notices are deemed received on the next business day after sending.

10.8 **Language.** This Agreement is provided in both English and French. In the event of any discrepancy, the English version shall prevail to the extent permitted by applicable law.

10.9 **Governing Law.** This Agreement is governed by and construed in accordance with the laws of the Province of British Columbia and the applicable federal laws of Canada. The courts of British Columbia have exclusive jurisdiction.

---

## ACCEPTANCE

**The Client accepts this Agreement electronically at enrollment:**

- Client Name: `[CLIENT_FULL_NAME]`
- Client Email: `[CLIENT_EMAIL]`
- IP Address: `[CLIENT_IP]`
- Acceptance Timestamp: `[CONSENT_ACCEPTED_AT]`
- Agreement Version: 0.1
- Effective Date: `[EFFECTIVE_DATE]`
- Anniversary Date: `[ANNIVERSARY_DATE]`

By clicking "Activate Recurring Plan," the Client acknowledges having read, understood, and agreed to the terms of this Agreement and the documents incorporated by reference.

---

*This document is version 0.1 of the Lulu Island Flagship Recurring Cleaning Service Agreement. It is a draft pending review by a lawyer qualified to practice in British Columbia. The system tracks version history, IPC adjustments, legal change alerts, and acceptance metadata; no version is ever deleted. The automated contract review (Section 8) runs sixty days before each anniversary. For the binding version governing a specific recurring relationship, consult the contract management system (`contract-review.ts`, `contract-ipc-adjustment.ts`, `legal-monitoring.ts`).*
