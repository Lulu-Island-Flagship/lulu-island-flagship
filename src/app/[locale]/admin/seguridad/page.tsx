"use client";

/**
 * v8.3 E0 — Panel de códigos de respaldo (backup codes) del owner_admin.
 * Acceso: solo owner_admin (la API lo exige vía requireAdminRole("security_backup_codes");
 * esta página solo renderiza -- mismo patrón que feature-flags/page.tsx).
 *
 * Propósito: 2FA de emergencia. Hoy el owner_admin solo entra por Google
 * OAuth. Si pierde acceso a esa cuenta (teléfono robado, cuenta bloqueada,
 * etc.), necesita un método de respaldo generado CON ANTELACIÓN mientras
 * todavía tiene acceso normal -- no un "olvidé mi contraseña" público.
 */

import React, { useState, useEffect } from "react";
import { Loader2, ShieldAlert, KeyRound, Copy, Check, AlertTriangle } from "lucide-react";

interface Status {
  hasCodes: boolean;
  generatedAt: string | null;
  totalInSet: number;
  unusedCount: number;
  usedCount: number;
}

export default function SeguridadPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ackSaved, setAckSaved] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/backup-codes");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error loading backup code status");
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError("");
    setAckSaved(false);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/backup-codes", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error generating codes");
      setNewCodes(json.codes);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
    }
  }

  async function copyAll() {
    if (!newCodes) return;
    try {
      await navigator.clipboard.writeText(newCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API puede no estar disponible (http, permisos) -- no es crítico,
      // los códigos siguen visibles en pantalla para copiar a mano.
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-brand-navy">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <ShieldAlert className="h-6 w-6 text-brand-navy" />
        <h1 className="text-2xl font-semibold text-brand-navy">Backup Codes</h1>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Códigos de un solo uso para entrar al panel de admin si pierdes acceso
        a tu cuenta de Google. Guárdalos fuera de este dispositivo (impresos o
        en un gestor de contraseñas) -- solo se muestran una vez, al
        generarlos.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">
          {error}
        </div>
      )}

      {status && (
        <div className="mb-6 rounded-lg border border-brand-ice bg-white p-4 shadow-elevation-1">
          {status.hasCodes ? (
            <div className="text-sm text-brand-ink space-y-1">
              <p>
                Set actual generado el{" "}
                <strong>
                  {status.generatedAt ? new Date(status.generatedAt).toLocaleString() : "—"}
                </strong>
              </p>
              <p>
                <strong className={status.unusedCount === 0 ? "text-state-danger" : "text-state-success"}>
                  {status.unusedCount}
                </strong>{" "}
                códigos sin usar de {status.totalInSet}
                {status.usedCount > 0 && ` (${status.usedCount} ya usados)`}
              </p>
              {status.unusedCount === 0 && (
                <p className="flex items-center gap-1 text-state-danger">
                  <AlertTriangle className="h-4 w-4" />
                  No te quedan códigos sin usar. Genera un set nuevo.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Todavía no has generado códigos de respaldo.
            </p>
          )}
        </div>
      )}

      {!newCodes && (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={generating}
          className="flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <KeyRound className="h-4 w-4" />
          {status?.hasCodes ? "Regenerate backup codes" : "Generate backup codes"}
        </button>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-elevation-3">
            <h2 className="mb-2 font-semibold text-brand-navy">
              {status?.hasCodes ? "Generate a new set?" : "Generate backup codes?"}
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              {status?.hasCodes && status.unusedCount > 0
                ? `This invalidates the ${status.unusedCount} unused code(s) from your current set immediately.`
                : "You'll get 10 single-use codes, shown only once."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-brand-ice px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={generating}
                aria-label={generating ? "Generating backup codes" : "Confirm backup code generation"}
                className="rounded-md bg-brand-navy px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {generating ? "Generating…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {newCodes && (
        <div className="rounded-lg border-2 border-state-warning bg-amber-50 p-4">
          <div className="mb-3 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-state-warning" />
            <p className="text-sm font-semibold text-brand-ink">
              Save these codes now. They will not be shown again -- if you lose
              them, you&apos;ll need to generate a new set (which invalidates these).
            </p>
          </div>
          <div className="mb-3 grid grid-cols-1 gap-1 rounded-md bg-white p-3 font-mono text-sm sm:grid-cols-2">
            {newCodes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={copyAll}
              aria-label={copied ? "Backup codes copied to clipboard" : "Copy all backup codes"}
              className="flex items-center gap-1 rounded-md border border-brand-ice px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy all"}
            </button>
          </div>
          <label htmlFor="backup-codes-ack-saved" className="flex items-start gap-2 text-sm text-brand-ink">
            <input
              id="backup-codes-ack-saved"
              type="checkbox"
              checked={ackSaved}
              onChange={(e) => setAckSaved(e.target.checked)}
              aria-label="I've saved these codes somewhere safe"
              className="mt-0.5"
            />
            I&apos;ve saved these codes somewhere safe.
          </label>
          {ackSaved && (
            <button
              onClick={() => setNewCodes(null)}
              className="mt-3 rounded-md bg-brand-navy px-4 py-2 text-sm text-white"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
