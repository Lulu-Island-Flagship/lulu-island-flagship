/**
 * v8.3 E0.8 — Adaptador de comunicaciones (Twilio/SMS + SendGrid/Email).
 *
 * Re-exporta las interfaces ya honestas de `src/lib/sms.ts` y
 * `src/lib/email.ts` (ambas "not_configured" hasta que exista proveedor
 * contratado) bajo un solo punto de importación por canal.
 */

export {
  sendSms,
  sendPaymentUpdateSms,
  buildPaymentUpdateLink,
  maskPhoneNumber,
  type SendSmsInput,
  type SendSmsResult,
} from "@/lib/sms";

export { sendEmail, maskEmail, type SendEmailInput, type SendEmailResult } from "@/lib/email";
