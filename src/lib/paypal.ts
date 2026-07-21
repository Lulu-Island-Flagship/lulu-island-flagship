/**
 * Verificación server-side de transacciones de PayPal.
 *
 * Soporta tanto capture IDs (pagos completados) como order IDs.
 * Requiere PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en variables de entorno.
 */

export interface PayPalVerificationResult {
  valid: boolean;
  transactionId: string;
  status?: string;
  amount?: number; // dollars CAD
  currency?: string;
  payerEmail?: string;
  error?: string;
}

function getPayPalBaseUrl(): string {
  // Usar sandbox si no se indica lo contrario; en producción se puede cambiar
  // a https://api.paypal.com o usar PAYPAL_ENVIRONMENT=live.
  return process.env.PAYPAL_ENVIRONMENT === "live"
    ? "https://api.paypal.com"
    : "https://api.sandbox.paypal.com";
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchCapture(
  accessToken: string,
  transactionId: string
): Promise<PayPalVerificationResult | null> {
  const res = await fetch(`${getPayPalBaseUrl()}/v2/payments/captures/${transactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`PayPal capture lookup failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    amount: { value: string; currency_code: string };
  };

  return {
    valid: data.status === "COMPLETED",
    transactionId: data.id,
    status: data.status,
    amount: Number(data.amount.value),
    currency: data.amount.currency_code,
  };
}

async function fetchOrder(
  accessToken: string,
  transactionId: string
): Promise<PayPalVerificationResult | null> {
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${transactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`PayPal order lookup failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    purchase_units?: Array<{
      amount: { value: string; currency_code: string };
      payments?: {
        captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }>;
      };
    }>;
    payer?: { email_address?: string };
  };

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const amountValue = capture?.amount?.value ?? data.purchase_units?.[0]?.amount?.value;
  const currencyCode = capture?.amount?.currency_code ?? data.purchase_units?.[0]?.amount?.currency_code;

  return {
    valid: data.status === "COMPLETED" || data.status === "APPROVED",
    transactionId: data.id,
    status: data.status,
    amount: amountValue ? Number(amountValue) : undefined,
    currency: currencyCode,
    payerEmail: data.payer?.email_address,
  };
}

export interface PayPalRefundResult {
  success: boolean;
  refundId?: string;
  status?: string;
  error?: string;
}

/**
 * Reembolsa (total o parcialmente) una captura de PayPal ya completada.
 * Fix B-P2-3 (auditoría 2026-07-21): cron/paypal-refunds nunca llamaba a
 * ningún endpoint real de PayPal, solo dejaba un TODO + console.log.
 *
 * @param captureId ID de la captura de PayPal (orders.paypal_transaction_id).
 * @param amount Monto a reembolsar en dólares CAD (opcional; si se omite,
 *   PayPal reembolsa el monto completo de la captura).
 * @param noteToPayer Nota visible para el pagador (opcional).
 */
export async function refundPayPalCapture(
  captureId: string,
  amount?: number,
  noteToPayer?: string
): Promise<PayPalRefundResult> {
  try {
    const accessToken = await getAccessToken();

    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
      body.amount = { value: amount.toFixed(2), currency_code: "CAD" };
    }
    if (noteToPayer) {
      body.note_to_payer = noteToPayer.slice(0, 255);
    }

    const res = await fetch(`${getPayPalBaseUrl()}/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        // Idempotencia: PayPal soporta PayPal-Request-Id para deduplicar
        // reintentos del mismo reembolso.
        "PayPal-Request-Id": `refund:${captureId}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      name?: string;
      message?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };

    if (!res.ok) {
      const detail =
        data.details?.map((d) => d.issue || d.description).filter(Boolean).join("; ") ||
        data.message ||
        `HTTP ${res.status}`;
      return { success: false, error: `PayPal refund failed: ${detail}` };
    }

    return { success: true, refundId: data.id, status: data.status };
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown PayPal refund error";
    return { success: false, error: message };
  }
}

/**
 * Verifica una transacción de PayPal.
 *
 * @param transactionId ID de la transacción (capture u order).
 * @param expectedAmount Monto esperado en dólares CAD (opcional).
 */
export async function verifyPayPalTransaction(
  transactionId: string,
  expectedAmount?: number
): Promise<PayPalVerificationResult> {
  try {
    const accessToken = await getAccessToken();

    // Intentar primero como capture ID (pago completado).
    let result = await fetchCapture(accessToken, transactionId);

    // Si no existe, intentar como order ID.
    if (!result) {
      result = await fetchOrder(accessToken, transactionId);
    }

    if (!result) {
      return {
        valid: false,
        transactionId,
        error: "Transaction not found in PayPal",
      };
    }

    if (expectedAmount !== undefined && result.amount !== undefined) {
      // Permitir diferencia de 1 centavo por redondeo
      if (Math.abs(result.amount - expectedAmount) > 0.01) {
        return {
          valid: false,
          transactionId,
          status: result.status,
          amount: result.amount,
          currency: result.currency,
          error: `Amount mismatch: expected ${expectedAmount} ${result.currency}, got ${result.amount} ${result.currency}`,
        };
      }
    }

    if (!result.valid) {
      return {
        valid: false,
        transactionId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        error: `Transaction status is ${result.status}`,
      };
    }

    return result;
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown PayPal error";
    return {
      valid: false,
      transactionId,
      error: message,
    };
  }
}
