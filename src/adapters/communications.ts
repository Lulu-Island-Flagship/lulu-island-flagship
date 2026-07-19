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

import { sendSms, type SendSmsInput, type SendSmsResult } from "@/lib/sms";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "@/lib/email";

/**
 * v8.3 E0 (auditoría 2026-07-18) — interfaz abstracta mínima + mock. Cubre
 * los dos canales base (sendSms/sendEmail); `sendPaymentUpdateSms` es un
 * wrapper de compatibilidad sobre sendSms (ver sms.ts) y no necesita entrada
 * propia en la interfaz.
 */
export interface CommunicationsAdapter {
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export const communicationsAdapter: CommunicationsAdapter = { sendSms, sendEmail };

export function createMockCommunicationsAdapter(
  overrides?: Partial<CommunicationsAdapter>
): CommunicationsAdapter {
  return {
    sendSms: async (_input: SendSmsInput) => ({
      status: "not_configured",
      maskedPhone: "***0000",
      providerResponse: null,
    }),
    sendEmail: async (_input: SendEmailInput) => ({
      status: "not_configured",
      maskedEmail: "m***@example.com",
      providerResponse: null,
    }),
    ...overrides,
  };
}
