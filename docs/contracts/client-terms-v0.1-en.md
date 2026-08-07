# CLIENT SERVICE AGREEMENT — ONE-TIME CLEANING
## Lulu Island Flagship | Richmond, British Columbia
**Version:** 0.1 (Draft — pending legal review by a BC-qualified lawyer)
**Date:** August 6, 2026
**Type:** `client_terms` (one-time booking — does not renew)
**Languages:** English | [Français](client-terms-v0.1-fr.md)

---

**This Agreement** is made between:

**Service Provider:** Lulu Island Flagship Cleaning Services Inc., a corporation incorporated under the laws of British Columbia, with its registered office in Richmond, B.C. ("the Company")

**Client:** `[CLIENT_FULL_NAME]`, residing at `[CLIENT_BILLING_ADDRESS]` ("the Client")

(Collectively "the Parties")

---

## 1. SERVICE SCOPE

1.1 **Property.** The cleaning service shall be performed at: `[SERVICE_ADDRESS]`, Richmond, B.C. (the "Property").

1.2 **BC Assessment Area.** The Property's floor area, as recorded by BC Assessment, is `[BC_ASSESSMENT_AREA]` square metres. This figure is obtained from the provincial database (`bc-assessment.ts`) and is the sole basis for pricing. The Client acknowledges that the fixed price is derived from this objectively verifiable measurement.

1.3 **Service Type.** The service is classified as: `[SERVICE_TYPE]` (e.g., Deep Clean, Maintenance Clean, Move-Out Clean).

1.4 **Zones Included.** The following zones are included in this service, each with its assigned weight from the Company's pricing engine (`pricing.ts`, `addon-zones.ts`):

| Zone | Weight | Included |
|---|---|---|
| `[ZONE_1_NAME]` | `[ZONE_1_WEIGHT]×` | Yes |
| `[ZONE_2_NAME]` | `[ZONE_2_WEIGHT]×` | Yes |
| ... | ... | ... |

1.5 **Add-Ons.** The following optional services have been added to this booking:

| Add-On | Price |
|---|---|
| `[ADDON_1_NAME]` | `$[ADDON_1_PRICE]` |
| `[ADDON_2_NAME]` | `$[ADDON_2_PRICE]` |

1.6 **Organic Load Adjustment.** The pricing includes an adjustment for organic load factors reported by the Client (pets: `[PET_COUNT]`; residents: `[RESIDENT_COUNT]`). Misrepresentation of these factors may result in a price correction or service refusal.

1.7 **Entropic Dirt Index (IES).** The Client has self-assessed the Property's condition at IES level `[IES_LEVEL]` (scale 1.0–4.0). A discrepancy of more than one full IES point discovered on arrival authorizes the Company to adjust the price or reschedule. Level 5 (biohazard) is excluded — see Section 9.

1.8 **Scheduled Date and Time.** The service is scheduled for `[SERVICE_DATE]` with an arrival window of `[ARRIVAL_WINDOW_START]` to `[ARRIVAL_WINDOW_END]`. The Company shall provide SMS or email notification when the team is en route (`live-tracking.ts`).

---

## 2. FIXED PRICE AND TAX

2.1 **Fixed Price.** The total price for this service is **`$[TOTAL_PRICE]` CAD**, calculated by the Company's pricing engine based on the BC Assessment area, zone weights, add-ons, organic load, and IES level. This price is fixed and upfront. The Client never sees an hourly rate or a price range.

2.2 **GST/HST.** Goods and Services Tax (GST) of `$[GST_AMOUNT]` CAD is included in the total above. The Company's GST/HST registration number is `[GST_NUMBER]`. This is charged in compliance with Part IX of the *Excise Tax Act* (Canada).

2.3 **No Hidden Charges.** The price quoted is the price the Client pays. No fuel surcharge, travel fee, or cleaning-product surcharge shall be added after booking unless the Client misrepresented material facts (see Sections 1.6–1.7).

---

## 3. PAYMENT

3.1 **Hold and Batch Capture.** The Client authorizes the Company to place a hold on the Client's payment card for the total price at the time of booking. The actual charge (capture) occurs within twenty-four (24) hours after the service is completed and approved through the Company's quality control process (`batch-capture-eligibility.ts`).

3.2 **Payment Method.** Payment is processed via Stripe, the Company's payment processor (`stripe.ts`). Card details are never stored on the Company's servers.

3.3 **Installment Option.** If the total price exceeds `$[INSTALLMENT_THRESHOLD]` CAD and the Client selected the installment option during checkout, the total shall be split into `[INSTALLMENT_COUNT]` equal payments captured on the schedule set out in the booking flow (`installment-payment.ts`).

3.4 **Declined Payment.** If the final capture is declined by the Client's financial institution, the Company shall notify the Client and provide forty-eight (48) hours to resolve the issue. If unresolved, Section 11 (Late Payment Interest) applies.

---

## 4. CANCELLATION AND RESCHEDULING

4.1 **Client Cancellation.** The Client may cancel this service without charge by providing at least forty-eight (48) hours' notice before the scheduled arrival window. Cancellation may be made through the Client Portal (`/account/services`) or by contacting the Company directly.

4.2 **Late Cancellation Fee.** If the Client cancels with less than forty-eight (48) hours' notice, the Company may charge a cancellation fee of `$[LATE_CANCELLATION_FEE]` CAD or `[LATE_CANCELLATION_PERCENT]%` of the total price, whichever is less.

4.3 **No-Show.** If the team arrives at the Property during the scheduled window and is unable to access the Property for reasons within the Client's control (including but not limited to: no answer, locked entry without key on file, or an unsafe environment), the service shall be treated as a late cancellation and the fee in Section 4.2 applies.

4.4 **Company Cancellation.** The Company reserves the right to cancel or reschedule due to: severe weather (`weather-exception.ts`), equipment failure, staff unavailability, or safety concerns. If the Company cancels, no charge shall be applied and the Company shall offer priority rescheduling.

4.5 **Cancellation Policy Page.** The full cancellation policy, including step-by-step instructions, is available at the Company's website (`/cancellation`) and is incorporated by reference into this Agreement.

---

## 5. WARRANTY AND QUALITY ASSURANCE

5.1 **Photo Evidence Guarantee.** The Company warrants that each zone serviced shall be cleaned to the Company's documented Standard Operating Procedure (SOP). After completion, the cleaning team shall capture timestamped, geotagged photographs of each zone through the Company's PWA system. These photographs are the sole evidence for warranty claims.

5.2 **Warranty Claim.** If the Client believes any zone was not cleaned to standard, the Client must submit a claim within twenty-four (24) hours of service completion through the post-service survey (`/review/[token]`) or the Client Portal. The claim shall be evaluated against the timestamped completion photographs by the Company's quality control team (`AdminQCClient.tsx`).

5.3 **Remedy.** If the quality control review confirms the claim, the Company shall, at its option: (a) re-clean the affected zone at no additional charge within `[REMEDY_WINDOW]` business days, or (b) issue a partial credit proportional to the affected zone's weight. The Company does not offer cash refunds.

5.4 **No Guarantee Without Evidence.** The warranty is conditional on photographic evidence from both Parties. The Company cannot process claims based solely on verbal descriptions (Invariant #6: Evidence over Opinion). The full warranty terms are published at the Company's website (`warranty-visibility.ts`, `warranty-dispute-resolution.ts`).

---

## 6. ACCESS TO PROPERTY

6.1 **Access Methods.** The Client shall provide access to the Property by one of the following methods, selected during booking:

- **Client present:** The Client or an authorized adult (18+) shall be present to admit the team.
- **Key on file:** The Client has provided a key stored in the Company's encrypted system (`key-handling.ts`, `crypto.ts`).
- **Lockbox / access code:** The Client has provided a lockbox code or door code, stored encrypted.

6.2 **No Access — No-Show.** If the team cannot access the Property through the method selected, Section 4.3 (No-Show) applies.

6.3 **Key Security.** All physical keys are tagged with a non-identifying code (never the Client's address). Keys and access codes are encrypted at rest and in transit. The key handling protocol (`key-handling.ts`) governs all key-related operations.

6.4 **Pets.** The Client shall secure all pets in a safe area away from the cleaning zones during the service. The Company is not responsible for pets that escape, become distressed, or interfere with the service.

---

## 7. CHEMICAL LOCKOUT AND PRODUCTS

7.1 **Company-Approved Products Only.** The Company uses only cleaning products registered in its chemical lockout system (`chemical-lockout.ts`). All products have Safety Data Sheets (SDS) available for Client review upon request.

7.2 **No Client-Provided Products.** The Company shall not use any cleaning product, tool, or equipment provided by the Client. The chemical lockout protocol prohibits the introduction of unregistered substances.

7.3 **Allergies and Sensitivities.** The Client may disclose known chemical allergies or sensitivities during booking. The Company shall, where operationally feasible, substitute products within its approved catalogue. If no approved substitute is available, the Company shall notify the Client before the service.

---

## 8. EXCLUSIONS

8.1 **The following are explicitly excluded from this service and from the scope of this Agreement:**

| Excluded Item | Reason |
|---|---|
| Biohazard (blood, bodily fluids, infectious waste) | Requires specialized remediation. Level 5 IES. |
| Mould, mildew, or fungal remediation | Requires certified mould remediation specialist. |
| Pest or rodent infestation, droppings, or nesting material | Requires licensed pest control. |
| Hoarding conditions (accumulation preventing access to surfaces) | Safety risk; requires specialized services. |
| Exterior windows above ground floor without safe access | Safety restriction. |
| Lifting or moving heavy furniture (>25 kg / 55 lbs) | Biomechanical safety (`biomechanical-index.ts`). |
| Cleaning of inside appliances (oven interior, refrigerator interior, dishwasher interior) | Covered only if selected as a paid add-on during booking. |

If the team arrives and discovers any excluded condition, the Company shall notify the Client immediately, pause the service, and provide a referral to a qualified specialist where possible. The late cancellation fee (Section 4.2) shall not apply if the Client could not reasonably have known of the excluded condition before the team's arrival.

---

## 9. LIABILITY AND INSURANCE

9.1 **Insurance Coverage.** The Company carries commercial general liability insurance and is registered with WorkSafeBC (`business-insurance.ts`). Certificate of insurance is available upon request.

9.2 **Pre-Existing Damage.** The Company is not responsible for damage that existed before the service. The cleaning team documents pre-existing conditions upon arrival through the PWA.

9.3 **Incidental Damage.** If the Company causes damage to the Client's property during the service, the Company shall notify the Client immediately, document the damage with timestamped photographs, and repair or replace the damaged item at the Company's expense up to the limit of the Company's insurance coverage.

9.4 **Valuables.** The Client shall secure or remove cash, jewellery, sensitive documents, and other high-value items before the service. The Company's liability for loss of unsecured valuables is limited to the amount recoverable under the Company's insurance policy.

9.5 **Limitation of Liability.** To the maximum extent permitted by law, the Company's total liability for any claim arising from this Agreement shall not exceed the total price paid by the Client for the specific service giving rise to the claim.

---

## 10. PRIVACY AND PERSONAL INFORMATION

10.1 **Collection of Personal Information.** The Company collects the Client's personal information for the following purposes only: service delivery (address, access instructions), communication (email, phone for scheduling and notifications), payment processing (Stripe), and legal compliance (GST/HST records). This collection is in compliance with the *Personal Information Protection Act* (BC) ("PIPA").

10.2 **Sensitive Information.** Access codes, alarm codes, and key information are encrypted at rest (`crypto.server.ts`) and accessible only to the assigned cleaning team leader for the duration of the scheduled service.

10.3 **No Sale or Unauthorized Disclosure.** The Company does not sell, rent, or disclose Client personal information to third parties except: (a) as required by law (e.g., CRA for tax records), (b) to the Company's payment processor (Stripe) for payment processing only, or (c) to the assigned cleaning team for service delivery only.

10.4 **Photo Data.** Completion photographs are stored as quality assurance evidence. Photographs contain only the cleaned surfaces — the Company's PWA system is configured to exclude faces and personal items from frame where feasible. Photographs are retained for the duration of the warranty period and any active dispute.

10.5 **Access and Correction.** The Client may request access to or correction of their personal information through the Client Portal or by contacting `[PRIVACY_OFFICER]`. The Company shall respond within thirty (30) days, per PIPA.

10.6 **Retention.** Client personal information is retained for seven (7) years after the last service for tax and business records, and securely destroyed thereafter unless an ongoing dispute or legal requirement mandates longer retention.

10.7 **Privacy Policy.** The Company's full Privacy Policy is published at the Company's website (`/privacy`) and is incorporated by reference.

---

## 11. LATE PAYMENT INTEREST

11.1 **Interest on Overdue Amounts.** If any amount payable by the Client under this Agreement remains unpaid for more than thirty (30) days after the due date, the Client shall pay interest on the overdue amount at the rate of **`[LATE_INTEREST_RATE]`% per annum**, calculated daily and compounded monthly, from the due date until the date of full payment.

11.2 **Interest Act Compliance.** The annual interest rate stated in Section 11.1 is the express yearly rate required by section 4 of the *Interest Act* (Canada). No interest expressed per day, week, or month shall be chargeable in excess of this annual rate.

11.3 **Collection Costs.** The Client shall reimburse the Company for reasonable costs incurred in collecting overdue amounts, including legal fees on a solicitor-client basis, to the extent permitted by law.

---

## 12. DISPUTE RESOLUTION

12.1 **Internal Resolution.** The Parties shall attempt to resolve any dispute arising from this Agreement through direct communication. The Client shall contact the Company through the Client Portal, by email at `[SUPPORT_EMAIL]`, or by phone at `[SUPPORT_PHONE]`.

12.2 **Evidence-Based Review.** Any dispute regarding service quality shall be resolved primarily by reference to the timestamped completion photographs taken by the cleaning team (Section 5.1) and any photographs submitted by the Client. The Company's quality control team shall issue a written determination within five (5) business days.

12.3 **Mediation.** If direct resolution and evidence-based review fail, the Parties agree to participate in mediation facilitated by a neutral third party before pursuing any other remedy.

12.4 **Governing Law.** This Agreement is governed by and construed in accordance with the laws of the Province of British Columbia and the applicable federal laws of Canada. The courts of British Columbia have exclusive jurisdiction.

---

## 13. ELECTRONIC SIGNATURE AND ACCEPTANCE

13.1 **Acceptance at Checkout.** The Client accepts this Agreement by clicking "Book Now" or an equivalent acceptance button during the online booking flow. This action constitutes an electronic signature with the same legal effect as a handwritten signature.

13.2 **Acceptance Record.** The Company records the Client's acceptance with the following metadata, stored immutably in the system: Client name, email, IP address, timestamp of acceptance (`consent_accepted_at`), and the exact version of this Agreement accepted (`consent_tc`). This record serves as the audit trail for this Agreement.

13.3 **Version Control.** The version of this Agreement accepted by the Client at the time of booking is the version that governs that specific service. Future bookings may be governed by updated versions of this Agreement, which the Client shall accept at each subsequent checkout.

13.4 **E-Signature Provider.** For bookings requiring a formal e-signature (e.g., B2B, high-value services), the Company uses a PIPEDA-compliant e-signature provider (`esignature-provider.ts`). The clickwrap acceptance in Section 13.1 is sufficient for consumer bookings.

---

## 14. GENERAL PROVISIONS

14.1 **Entire Agreement.** This Agreement, together with the documents incorporated by reference (Cancellation Policy at `/cancellation` and Privacy Policy at `/privacy`), constitutes the entire agreement between the Parties with respect to the specific service identified in Section 1 and supersedes all prior discussions, representations, and agreements, whether written or oral.

14.2 **No Waiver.** The failure of either Party to enforce any provision of this Agreement shall not constitute a waiver of that provision or of any other provision.

14.3 **Severability.** If any provision of this Agreement is held invalid or unenforceable by a court of competent jurisdiction, the remaining provisions shall continue in full force and effect, and the invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable.

14.4 **Force Majeure.** Neither Party shall be liable for failure or delay in performance caused by events beyond their reasonable control, including but not limited to: natural disasters, extreme weather (`weather-provider.ts`, `weather-exception.ts`), pandemic, civil unrest, or government order. The affected Party shall notify the other promptly and resume performance as soon as reasonably practicable.

14.5 **Assignment.** The Client may not assign this Agreement without the Company's prior written consent. The Company may assign this Agreement to a successor entity in the event of a merger, acquisition, or sale of substantially all of its assets.

14.6 **Language.** This Agreement is provided in both English and French. In the event of any discrepancy, the English version shall prevail to the extent permitted by applicable law.

---

## ACCEPTANCE

**The Client accepts this Agreement electronically at checkout:**

- Client Name: `[CLIENT_FULL_NAME]`
- Client Email: `[CLIENT_EMAIL]`
- IP Address: `[CLIENT_IP]`
- Acceptance Timestamp: `[CONSENT_ACCEPTED_AT]`
- Agreement Version: 0.1 (`consent_tc`)

By clicking "Book Now," the Client acknowledges having read, understood, and agreed to the terms of this Agreement, including the Cancellation Policy and Privacy Policy incorporated by reference.

---

*This document is version 0.1 of the Lulu Island Flagship Client Service Agreement (one-time). It is a draft pending review by a lawyer qualified to practice in British Columbia. The system tracks version history and acceptance metadata; no version is ever deleted. For the binding version of a specific booking, consult the acceptance record associated with that booking in the Company's contract management system.*
