"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Key, Loader2, ChevronLeft, AlertTriangle, Check, Eye, EyeOff, Camera, CloudUpload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { submitGenericReportOrQueue } from "@/lib/offline-sync-client";

type KeyMethod = "in_person" | "lockbox" | "third_party" | "problem";

interface KeyLog {
  id: string;
  method: KeyMethod;
  lockbox_code?: string;
  confirmed_returned?: boolean;
  escalated_at?: string;
  escalation_resolved_as?: string;
  created_at: string;
}

const METHODS: { value: KeyMethod; label: string }[] = [
  { value: "in_person", label: "En persona" },
  { value: "lockbox", label: "Lockbox" },
  { value: "third_party", label: "Tercero" },
  { value: "problem", label: "Problema de acceso" },
];

export default function LlavesPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.orderId as string;

  // 2026-07-25: antes leía window.location.pathname, lo que causaba un
  // hydration mismatch (SSR asumía "en", cliente calculaba el locale real).
  // useParams() da el mismo valor en servidor y cliente porque viene del
  // router de Next, no de window.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [logs, setLogs] = useState<KeyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<KeyMethod>("in_person");
  const [lockboxCode, setLockboxCode] = useState("");
  // v8.3 ROUND 4 fix (#9): el código del lockbox se mostraba en texto plano
  // en pantalla (type="text") -- cualquiera mirando por encima del hombro
  // del empleado, o una captura de pantalla, lo exponía. Mismo patrón
  // Eye/EyeOff de toggle de visibilidad ya usado para los backup codes de
  // admin (admin/seguridad/page.tsx).
  const [showLockboxCode, setShowLockboxCode] = useState(false);
  const [confirmedReturned, setConfirmedReturned] = useState(false);
  const [error, setError] = useState("");
  // Fix (auditoría 2026-07-31, #13): el método "Tercero" (third_party) no
  // capturaba ninguna evidencia -- pero el servidor (validateKeyLog en
  // src/lib/key-handling.ts, vía requirementsForMethod) SIEMPRE exige
  // signatureUrl para este método. Sin esta captura, cualquier submit con
  // method="third_party" fallaba en el servidor con "Faltan campos
  // requeridos: signatureUrl", dejando este método totalmente inutilizable.
  // Se reutiliza el mismo patrón de "foto como evidencia firmada" que ya
  // usa ClosureProtocolPanel.tsx para el recibo de pago alternativo (sube a
  // Storage, bucket service-photos).
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  // Fix (auditoría implacable, hallazgo nuevo): este formulario enviaba el
  // registro de manejo de llaves (evidencia física -- código de lockbox,
  // firma de tercero, confirmación de devolución) con un fetch plano, sin
  // ningún mecanismo de reintento. Un líder que registra el acceso al salir
  // de una zona sin señal (el caso de uso típico de esta pantalla, ver
  // CONTEXTO en la auditoría) perdía el registro por completo -- mismo
  // patrón de "cola offline" que ya usan enfermedad/page.tsx y
  // seguridad/page.tsx vía submitGenericReportOrQueue.
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (orderId) load();
  }, [orderId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/empleado/llaves?orderId=${orderId}`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSignaturePhoto(file: File) {
    setUploadingSignature(true);
    setSignatureError("");
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/key-handoff-signature/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });
      if (uploadError) {
        console.error("Signature upload error:", uploadError);
        setSignatureError("No se pudo subir la evidencia. Intenta de nuevo.");
        return;
      }
      const { data: publicUrlData } = supabase.storage.from("service-photos").getPublicUrl(fileName);
      setSignatureUrl(publicUrlData.publicUrl);
    } catch (e) {
      console.error("Signature photo error:", e);
      setSignatureError("Error de conexión al subir la evidencia. Intenta de nuevo.");
    } finally {
      setUploadingSignature(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setQueued(false);
    try {
      const result = await submitGenericReportOrQueue("/api/empleado/llaves", {
        orderId,
        method,
        lockboxCode: method === "lockbox" ? lockboxCode : undefined,
        confirmedReturned: method === "in_person" ? confirmedReturned : undefined,
        signatureUrl: method === "third_party" ? signatureUrl : undefined,
      });
      if (!result.ok) {
        setError(result.error || "Error al registrar.");
        return;
      }
      setLockboxCode("");
      setConfirmedReturned(false);
      setSignatureUrl(null);
      if (result.queued) {
        // Sin señal: el registro quedó en la cola local y se enviará solo
        // en cuanto vuelva la conexión -- no se pierde, pero tampoco puede
        // aparecer todavía en la lista de abajo (esa lista viene del
        // servidor, ver load()).
        setQueued(true);
      } else {
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmitThirdParty = method !== "third_party" || !!signatureUrl;

  const pendingProblem = logs.find((l) => l.method === "problem" && l.escalation_resolved_as === "pending");

  return (
    <main className="min-h-screen bg-brand-ice">
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => router.push(`/${safeLocale}/empleado/servicio/${orderId}`)}
            aria-label="Volver"
            className="text-white/70 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold text-sm flex items-center gap-2">
            <Key className="w-4 h-4" /> Manejo de Llaves
          </h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {pendingProblem && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Hay un problema de acceso reportado y pendiente de resolver. Si pasan 15 min sin respuesta del admin, se documenta como no-show.</span>
          </div>
        )}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : (
          <>
            <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-brand-ink">Registrar acceso</h2>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    type="button"
                    key={m.value}
                    onClick={() => setMethod(m.value)}
                    className={`text-sm px-3 py-2 rounded-lg font-medium ${
                      method === m.value ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {method === "lockbox" && (
                <div className="relative">
                  <input
                    type={showLockboxCode ? "text" : "password"}
                    aria-label="Código del lockbox"
                    placeholder="Código del lockbox"
                    value={lockboxCode}
                    onChange={(e) => setLockboxCode(e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLockboxCode((v) => !v)}
                    aria-label={showLockboxCode ? "Ocultar código del lockbox" : "Mostrar código del lockbox"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showLockboxCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}

              {method === "in_person" && (
                <label htmlFor="keys-confirm-returned" className="flex items-center gap-2 text-sm">
                  <input
                    id="keys-confirm-returned"
                    type="checkbox"
                    aria-label="Confirmo que devolví las llaves al cliente"
                    checked={confirmedReturned}
                    onChange={(e) => setConfirmedReturned(e.target.checked)}
                  />
                  Confirmo que devolví las llaves al cliente
                </label>
              )}

              {method === "third_party" && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Requiere evidencia: foto de la nota/recibo firmado por el tercero que entregó o recibió las
                    llaves.
                  </p>
                  {signatureUrl ? (
                    <div className="flex items-center gap-2 text-xs text-state-success">
                      <Check className="w-4 h-4" /> Evidencia subida
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-3 text-sm text-gray-500 cursor-pointer">
                      {uploadingSignature ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                      {uploadingSignature ? "Subiendo..." : "Tomar/adjuntar foto de la evidencia firmada"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingSignature}
                        // Fix (CI #67, auditoría a11y E6-C7): aunque el <input>
                        // ya está anidado dentro del <label> de arriba (nombre
                        // accesible válido por anidamiento JSX real), el
                        // escáner estático de scripts/audit-accessibility.mjs
                        // no evalúa el DOM real -- solo detecta patrones de
                        // texto -- y lo marcó como "sin nombre accesible"
                        // (falso positivo, el propio audit lo advierte en su
                        // mensaje). Se agrega aria-label explícito, redundante
                        // pero inequívoco para cualquier lector de pantalla y
                        // para el escáner, mismo criterio que el checkbox de
                        // "Confirmo que devolví las llaves" más arriba.
                        aria-label="Tomar o adjuntar foto de la evidencia firmada"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleSignaturePhoto(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {signatureError && <p className="text-xs text-red-600">{signatureError}</p>}
                </div>
              )}

              {method === "problem" && (
                <p className="text-xs text-gray-500">
                  Esto notifica al admin de inmediato. Si no hay respuesta en 15 min, se escala automáticamente.
                </p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}
              {queued && (
                <p className="text-xs text-brand-navy flex items-center gap-1">
                  <CloudUpload className="w-3.5 h-3.5" /> Sin conexión: se guardó en el dispositivo y se enviará
                  solo en cuanto vuelva la señal.
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !canSubmitThirdParty}
                className="w-full flex items-center justify-center gap-2 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Registrar
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {logs.length === 0 && <p className="p-4 text-sm text-gray-500">Sin registros todavía.</p>}
              {logs.map((l) => (
                <div key={l.id} className="p-3 text-sm">
                  <span className="font-medium capitalize">{l.method.replace("_", " ")}</span>
                  <span className="text-gray-400 ml-2">{new Date(l.created_at).toLocaleTimeString("en-CA")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
