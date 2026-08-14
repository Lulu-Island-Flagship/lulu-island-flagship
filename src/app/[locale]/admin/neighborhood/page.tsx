"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Home, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

interface Complaint {
  id: string;
  description: string;
  created_at: string;
  client_properties: { address: string } | null;
}

interface Lead {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  converted_to_client: boolean;
  created_at: string;
}

export default function NeighborhoodPage() {
  const t = useTranslations("admin.neighborhood");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [complaintForm, setComplaintForm] = useState({ clientPropertyId: "", description: "" });
  const [leadForm, setLeadForm] = useState({ name: "", contactPhone: "", contactEmail: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/neighborhood", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      const data = await res.json();
      setComplaints(data.complaints || []);
      setLeads(data.leads || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitComplaint(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/neighborhood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "log_complaint", ...complaintForm }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorGeneric"));
        return;
      }
      setShowComplaintForm(false);
      setComplaintForm({ clientPropertyId: "", description: "" });
      await load();
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/neighborhood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "log_lead", ...leadForm }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorGeneric"));
        return;
      }
      setShowLeadForm(false);
      setLeadForm({ name: "", contactPhone: "", contactEmail: "", notes: "" });
      await load();
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowComplaintForm(true)} className="text-sm text-brand-navy hover:underline">
            {t("logComplaint")}
          </button>
          <button
            onClick={() => setShowLeadForm(true)}
            className="inline-flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> {t("logNeighborLead")}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showComplaintForm && (
        <form onSubmit={submitComplaint} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("logNeighborComplaint")}</h2>
            <button type="button" onClick={() => setShowComplaintForm(false)} aria-label={t("closeForm")}><X className="w-5 h-5 text-gray-400" aria-hidden="true" /></button>
          </div>
          <input type="text" aria-label={t("propertyId")} placeholder={t("propertyId")} value={complaintForm.clientPropertyId} onChange={(e) => setComplaintForm((f) => ({ ...f, clientPropertyId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <textarea aria-label={t("complaintDescription")} placeholder={t("description")} value={complaintForm.description} onChange={(e) => setComplaintForm((f) => ({ ...f, description: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} required />
          <button type="submit" aria-label={t("saveNeighborComplaint")} disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? t("saving") : t("save")}
          </button>
        </form>
      )}

      {showLeadForm && (
        <form onSubmit={submitLead} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("logNeighborLead")}</h2>
            <button type="button" onClick={() => setShowLeadForm(false)} aria-label={t("closeForm")}><X className="w-5 h-5 text-gray-400" aria-hidden="true" /></button>
          </div>
          <input type="text" aria-label={t("neighborName")} placeholder={t("name")} value={leadForm.name} onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="tel" aria-label={t("contactPhoneOptional")} placeholder={t("phoneOptional")} value={leadForm.contactPhone} onChange={(e) => setLeadForm((f) => ({ ...f, contactPhone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input type="email" aria-label={t("contactEmailOptional")} placeholder={t("emailOptional")} value={leadForm.contactEmail} onChange={(e) => setLeadForm((f) => ({ ...f, contactEmail: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <textarea aria-label={t("leadNotes")} placeholder={t("notes")} value={leadForm.notes} onChange={(e) => setLeadForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
          <button type="submit" aria-label={t("saveNeighborLead")} disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? t("saving") : t("save")}
          </button>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("neighborComplaints")}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {complaints.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Home className="w-8 h-8 text-gray-300 mx-auto mb-2" /> {t("noneLogged")}
            </div>
          ) : (
            complaints.map((c) => (
              <div key={c.id} className="p-3 text-sm">
                <p className="text-brand-ink font-medium">{c.client_properties?.address ?? t("unknownAddress")}</p>
                <p className="text-xs text-gray-500">{c.description}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("neighborLeads")}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {leads.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">{t("noneLogged")}</div>
          ) : (
            leads.map((l) => (
              <div key={l.id} className="p-3 text-sm">
                <p className="text-brand-ink font-medium">{l.name}</p>
                <p className="text-xs text-gray-500">{[l.contact_phone, l.contact_email].filter(Boolean).join(" · ")}</p>
                {l.notes && <p className="text-xs text-gray-400">{l.notes}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
