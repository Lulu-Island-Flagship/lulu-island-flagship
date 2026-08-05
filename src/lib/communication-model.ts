// Capa 3: Canonical Communication Model
// This model serves as the target schema for all communication domains.
// Legacy modules continue using communication_attempts (Capa 0) during transition.

export type CommunicationChannel = "email" | "sms" | "chat" | "push" | "whatsapp";

export type CommunicationDirection = "inbound" | "outbound";

export type CommunicationStatus = "pending" | "sent" | "failed" | "delivered" | "read";

export interface CanonicalCommunication {
  communication_id: string;
  conversation_id: string | null;
  business_object: { type: string; id: string };
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  sender: { type: "system" | "user" | "employee"; id: string };
  recipients: Array<{ type: string; id: string }>;
  template_id: string | null;
  subject: string | null;
  body: string;
  variables: Record<string, string>;
  status: CommunicationStatus;
  delivered_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
}
