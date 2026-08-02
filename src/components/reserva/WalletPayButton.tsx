"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useStripe } from "@stripe/react-stripe-js";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, QrCode, ExternalLink } from "lucide-react";

interface WalletPayButtonProps {
  walletType: "alipay" | "wechat_pay";
  quoteId: string;
  disabled?: boolean;
  /** Ya confirmado (por ejemplo, tras volver del redirect de Alipay). */
  confirmedPaymentIntentId: string;
  onPaymentConfirmed: (paymentIntentId: string) => void;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos -- tiempo razonable para escanear un QR

/**
 * Botón de pago completo por adelantado vía Alipay o WeChat Pay (feature
 * 2026-07-21). A diferencia de ApplePayButton/StripeCardForm (que tokenizan
 * una tarjeta para cobrar DESPUÉS vía SetupIntent), este componente cobra el
 * 100% del total DE INMEDIATO contra un PaymentIntent real creado por
 * /api/stripe/wallet-intent -- ver ese archivo y order-cancellation.ts para
 * el razonamiento completo (estos medios no soportan cobro off_session
 * confiable semanas después).
 *
 * Alipay: confirmAlipayPayment hace un redirect completo fuera de la página
 * (a la app/web de Alipay) y vuelve a `return_url` con
 * ?payment_intent=...&payment_intent_client_secret=...&redirect_status=...
 * en la URL -- el padre (page.tsx) debe leer esos params al montar y pasar
 * el id ya confirmado via `confirmedPaymentIntentId`.
 *
 * WeChat Pay: confirmWechatPayPayment NO redirige -- devuelve un código QR
 * para renderizar en la misma página; el cliente lo escanea con la app de
 * WeChat, y este componente hace polling del estado del PaymentIntent hasta
 * que se complete.
 */
export function WalletPayButton({
  walletType,
  quoteId,
  disabled,
  confirmedPaymentIntentId,
  onPaymentConfirmed,
}: WalletPayButtonProps) {
  const t = useTranslations("reserva.walletPayButton");
  const tPayment = useTranslations("reserva.payment");
  const stripe = useStripe();
  const [status, setStatus] = useState<"idle" | "creating" | "pending" | "succeeded" | "error">(
    confirmedPaymentIntentId ? "succeeded" : "idle"
  );
  const [error, setError] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  useEffect(() => {
    if (confirmedPaymentIntentId) {
      setStatus("succeeded");
      onPaymentConfirmed(confirmedPaymentIntentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedPaymentIntentId]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Fix (auditoría externa, verificado 2026-07-31): stripe.retrievePaymentIntent
  // no estaba envuelto en try/catch -- un error de red transitorio durante el
  // polling (WiFi inestable mientras el cliente escanea el QR, por ejemplo)
  // producía un unhandled promise rejection en cada tick sin que el usuario
  // se enterara ni el código lo registrara; el polling seguía intentando
  // ciegamente hasta el timeout de 5 minutos igualmente, así que no bloqueaba
  // el flujo, pero fallaba en silencio sin ninguna señal para diagnóstico.
  // Se agrega manejo explícito: se loguea el error y se sigue esperando el
  // próximo tick (el timeout de POLL_TIMEOUT_MS ya acota cuántas veces esto
  // puede repetirse).
  const pollWechatStatus = (clientSecret: string, paymentIntentId: string) => {
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    pollTimerRef.current = setInterval(async () => {
      if (!stripe) return;
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        setStatus("error");
        setError(t("paymentTimedOut"));
        return;
      }
      try {
        const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
        if (paymentIntent?.status === "succeeded") {
          stopPolling();
          setStatus("succeeded");
          onPaymentConfirmed(paymentIntentId);
        } else if (paymentIntent?.status === "canceled") {
          stopPolling();
          setStatus("error");
          setError(t("paymentCancelled"));
        }
        // "requires_action" (QR aún no escaneado) -- seguir esperando.
      } catch (err) {
        // Error de red transitorio -- no se detiene el polling, solo se
        // registra; el próximo tick reintenta, y POLL_TIMEOUT_MS acota el
        // total de intentos.
        console.error("WeChat Pay polling error (will retry):", err);
      }
    }, POLL_INTERVAL_MS);
  };

  const handlePay = async () => {
    if (!stripe) return;
    setStatus("creating");
    setError("");

    try {
      const res = await fetch("/api/stripe/wallet-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, walletType }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("couldNotStart"));
      }

      const { clientSecret, paymentIntentId } = await res.json();

      if (walletType === "alipay") {
        setStatus("pending");
        // Redirect completo fuera de la página -- Stripe vuelve a esta misma
        // URL con los params de resultado ya en el querystring.
        // Fix (auditoría externa, verificado 2026-07-31): antes se enviaba
        // window.location.href COMPLETA (con querystring) como return_url --
        // si la página ya tenía sus propios query params (ej. de un intento
        // previo, un paso guardado, tracking de campaña, etc.), Stripe los
        // reenviaría de vuelta MEZCLADOS con sus propios params de resultado
        // (payment_intent, payment_intent_client_secret, redirect_status),
        // pudiendo confundir la lógica de la página al volver (params viejos
        // interpretados como si fueran del resultado actual). Se usa origin
        // + pathname (sin querystring) -- la página al volver solo recibe
        // los params que Stripe realmente agrega.
        const { error: confirmError } = await stripe.confirmAlipayPayment(clientSecret, {
          return_url: window.location.origin + window.location.pathname,
        });
        if (confirmError) {
          setStatus("error");
          setError(confirmError.message || t("genericPaymentFailed"));
        }
        // Si no hay error, el navegador ya está navegando a Alipay -- no hay
        // más que hacer aquí, la página se recarga al volver.
      } else {
        const { paymentIntent, error: confirmError } = await stripe.confirmWechatPayPayment(
          clientSecret,
          { payment_method_options: { wechat_pay: { client: "web" } } },
          { handleActions: false }
        );

        if (confirmError) {
          setStatus("error");
          setError(confirmError.message || t("genericPaymentFailed"));
          return;
        }

        const qrData = paymentIntent?.next_action?.wechat_pay_display_qr_code;

        if (qrData?.image_data_url) {
          setQrCodeUrl(qrData.image_data_url);
          setStatus("pending");
          pollWechatStatus(clientSecret, paymentIntentId);
        } else if (paymentIntent?.status === "succeeded") {
          setStatus("succeeded");
          onPaymentConfirmed(paymentIntentId);
        } else {
          setStatus("error");
          setError(t("couldNotDisplayQr"));
        }
      }
    } catch (err: Error | unknown) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t("genericPaymentFailed"));
    }
  };

  const methodLabel = walletType === "alipay" ? tPayment("alipay") : tPayment("wechatPay");

  if (status === "succeeded") {
    return (
      <div className="flex items-center gap-2 p-3 bg-state-success/10 text-state-success rounded-lg text-sm">
        <CheckCircle2 className="w-5 h-5" />
        <span>
          {t("paymentReceivedFull", { method: methodLabel })}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {status === "pending" && walletType === "wechat_pay" && qrCodeUrl && (
        <div className="flex flex-col items-center gap-2 p-4 border border-gray-200 rounded-lg">
          <Image
            src={qrCodeUrl}
            alt={t("scanQrInstruction")}
            width={192}
            height={192}
            unoptimized
            className="w-48 h-48"
          />
          <p className="text-sm text-gray-600 flex items-center gap-1">
            <QrCode className="w-4 h-4" /> {t("scanQrInstruction")}
          </p>
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      )}

      {status !== "pending" && (
        <button
          type="button"
          onClick={handlePay}
          disabled={!stripe || disabled || status === "creating"}
          className="w-full inline-flex items-center justify-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "creating" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ExternalLink className="w-5 h-5" />
          )}
          {t("payFullAmountWith", { method: methodLabel })}
        </button>
      )}

      {error && (
        <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">{error}</div>
      )}
    </div>
  );
}
