"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Users, Copy, CheckCircle2, Gift } from "lucide-react";

interface Leader {
  id: string;
  name: string;
}

/**
 * v8.3 E5.13 — "Lulu Ambassador": página del cliente para (a) ver/generar su
 * código de referido si es VIP (>5 servicios, score >80), y (b) canjear un
 * código recibido de otro cliente (una sola vez por cuenta).
 */
export default function ReferralsPage() {
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [creditCents, setCreditCents] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const [redeemCode, setRedeemCode] = useState("");
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [mentionedLeaderId, setMentionedLeaderId] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState("");
  const [redeemError, setRedeemError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [refRes, leadersRes] = await Promise.all([
        fetch("/api/client/referral", { credentials: "include" }),
        fetch("/api/client/referral/leaders", { credentials: "include" }),
      ]);
      if (refRes.ok) {
        const data = await refRes.json();
        setEligible(Boolean(data.eligible));
        setMyCode(data.code || null);
        setCreditCents(data.creditCents || 0);
      }
      if (leadersRes.ok) {
        const data = await leadersRes.json();
        setLeaders(data.leaders || []);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard puede fallar en algunos navegadores/permiso -- no es crítico
    }
  }

  async function submitRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemError("");
    setRedeemMessage("");
    try {
      const res = await fetch("/api/client/referral/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: redeemCode.trim(),
          mentionedEmployeeId: mentionedLeaderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemError(data.error || "Could not redeem this code");
        return;
      }
      setRedeemMessage(data.message);
      setRedeemCode("");
    } catch {
      setRedeemError("Network error");
    } finally {
      setRedeeming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Lulu Ambassador</h1>
        <p className="text-sm text-gray-500 mt-1">
          Refer a friend, both of you get Lulu Wallet credit once they complete their first service.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {eligible ? (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-gold-dark" />
            <p className="font-medium text-brand-ink text-sm">Your referral code</p>
          </div>
          {myCode ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-brand-ice rounded-lg px-4 py-2 text-lg font-mono font-semibold text-brand-ink">
                {myCode}
              </code>
              <button
                aria-label="Copiar código de referido"
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-navy text-white px-3 py-2 rounded-lg"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
          )}
          <p className="text-xs text-gray-500">
            Share this code. When your friend completes their first service, you both get ${((creditCents || 3000) / 100).toFixed(2)}.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-5 text-sm text-gray-500">
          <Gift className="w-6 h-6 text-gray-300 mb-2" />
          Referral codes are available to VIP clients (more than 5 completed services and a great account
          standing). Keep booking with us -- you&apos;ll unlock it soon.
        </div>
      )}

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <p className="font-medium text-brand-ink text-sm">Have a code from a friend?</p>
        <form onSubmit={submitRedeem} className="space-y-2">
          <input
            aria-label="Código de referido de un amigo"
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            placeholder="e.g. MARIA-AB12"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
          />
          {leaders.length > 0 && (
            <select
              aria-label="Líder de equipo que nos recomendó (opcional)"
              value={mentionedLeaderId}
              onChange={(e) => setMentionedLeaderId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Did a team leader recommend us? (optional)</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          {redeemError && <p className="text-xs text-state-danger">{redeemError}</p>}
          {redeemMessage && <p className="text-xs text-state-success">{redeemMessage}</p>}
          <button
            aria-label="Aplicar código de referido"
            type="submit"
            disabled={redeeming || !redeemCode.trim()}
            className="w-full bg-brand-navy text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {redeeming ? "Applying..." : "Apply code"}
          </button>
        </form>
      </div>
    </div>
  );
}
