"use client";

import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle, Plus, X } from "lucide-react";
import { REQUIRED_POLICY_TYPES, REQUIRED_COVERAGE_CENTS, type PolicyType } from "@/lib/business-insurance";

interface Policy {
  id: string;
  policy_type: PolicyType;
  provider: string;
  policy_number: string | null;
  coverage_amount_cents: number;
  effective_from: string;
  expiry_date: string;
  status: "active" | "expiring_soon" | "expired";
  meetsRequiredCoverage: boolean;
}

const POLICY_TYPE_LABEL: Record<PolicyType, string> = {
  vehicular: "Vehicular liability",
  general_liability: "General liability",
  errors_omissions: "Errors & Omissions",
};

const STATUS_STYLE: Record<Policy["status"], { icon: typeof ShieldCheck; className: string; label: string }> = {
  active: { icon: ShieldCheck, className: "text-state-success", label: "Active" },
  expiring_soon: { icon: AlertTriangle, className: "text-state-warning", label: "Expiring soon" },
  expired: { icon: ShieldAlert, className: "text-state-danger", label: "EXPIRED" },
};

export default function BusinessInsurancePage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [missing, setMissing] = useState<PolicyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    policyType: "vehicular" as PolicyType,
    provider: "",
    policyNumber: "",
    coverageAmountDollars: "",
    effectiveFrom: "",
    expiryDate: "",
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/business-insurance", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setPolicies(data.policies || []);
      setMissing(data.missingPolicyTypes || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/business-insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          policyType: form.policyType,
          provider: form.provider.trim(),
          policyNumber: form.policyNumber.trim() || undefined,
          coverageAmountDollars: Number(form.coverageAmountDollars),
          effectiveFrom: form.effectiveFrom,
          expiryDate: form.expiryDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setForm({ policyType: "vehicular", provider: "", policyNumber: "", coverageAmountDollars: "", effectiveFrom: "", expiryDate: "" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">Business Insurance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vehicular, general liability, and E&amp;O policies. This registry does not by itself enable any
            &quot;insured/bonded&quot; claim on the site — that requires your separate written confirmation (B.4).
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add / Renew Policy
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {missing.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Missing policies on file: {missing.map((t) => POLICY_TYPE_LABEL[t]).join(", ")}.
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">New / Renewed Policy</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Policy type</label>
              <select
                aria-label="Tipo de póliza"
                value={form.policyType}
                onChange={(e) => setForm((f) => ({ ...f, policyType: e.target.value as PolicyType }))}
                className="border rounded-lg px-3 py-2 text-sm w-full"
              >
                {REQUIRED_POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {POLICY_TYPE_LABEL[t]} (min. ${(REQUIRED_COVERAGE_CENTS[t] / 100).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              aria-label="Proveedor o corredor de seguros"
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              placeholder="Provider / broker"
              className="border rounded-lg px-3 py-2 text-sm"
              required
            />
            <input
              type="text"
              aria-label="Número de póliza"
              value={form.policyNumber}
              onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))}
              placeholder="Policy number (optional)"
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              aria-label="Monto de cobertura en dólares"
              min={0}
              step="0.01"
              value={form.coverageAmountDollars}
              onChange={(e) => setForm((f) => ({ ...f, coverageAmountDollars: e.target.value }))}
              placeholder="Coverage amount ($)"
              className="border rounded-lg px-3 py-2 text-sm"
              required
            />
            <div>
              <label className="text-xs text-gray-500 block mb-1">Effective from</label>
              <input
                type="date"
                aria-label="Fecha de inicio de vigencia"
                value={form.effectiveFrom}
                onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Expiry date</label>
              <input
                type="date"
                aria-label="Fecha de expiración de la póliza"
                value={form.expiryDate}
                onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            aria-label="Guardar póliza de seguro"
            disabled={saving}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Policy"}
          </button>
        </form>
      )}

      {policies.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <ShieldAlert className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No policies registered yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {policies.map((p) => {
            const style = STATUS_STYLE[p.status];
            const Icon = style.icon;
            return (
              <div key={p.id} className="bg-white rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-brand-ink">{POLICY_TYPE_LABEL[p.policy_type]}</h3>
                  <span className={`flex items-center gap-1 text-xs font-medium ${style.className}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {style.label}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{p.provider}</p>
                <p className="text-xs text-gray-400">
                  ${(p.coverage_amount_cents / 100).toLocaleString()} coverage
                  {!p.meetsRequiredCoverage && (
                    <span className="text-state-warning font-medium"> — below spec minimum</span>
                  )}
                </p>
                <p className="text-xs text-gray-400">Expires {p.expiry_date}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
