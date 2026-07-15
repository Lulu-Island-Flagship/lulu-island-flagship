"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Home, Plus, X } from "lucide-react";

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
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [complaintForm, setComplaintForm] = useState({ clientPropertyId: "", description: "" });
  const [leadForm, setLeadForm] = useState({ name: "", contactPhone: "", contactEmail: "", notes: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/neighborhood", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setComplaints(data.complaints || []);
      setLeads(data.leads || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

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
        setError(err.error || "Failed");
        return;
      }
      setShowComplaintForm(false);
      setComplaintForm({ clientPropertyId: "", description: "" });
      await load();
    } catch {
      setError("Network error");
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
        setError(err.error || "Failed");
        return;
      }
      setShowLeadForm(false);
      setLeadForm({ name: "", contactPhone: "", contactEmail: "", notes: "" });
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
        <h1 className="text-2xl font-bold text-brand-ink">Neighborhood</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowComplaintForm(true)} className="text-sm text-brand-navy hover:underline">
            Log Complaint
          </button>
          <button
            onClick={() => setShowLeadForm(true)}
            className="inline-flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Log Neighbor Lead
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showComplaintForm && (
        <form onSubmit={submitComplaint} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Log Neighbor Complaint</h2>
            <button type="button" onClick={() => setShowComplaintForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <input type="text" placeholder="Property ID" value={complaintForm.clientPropertyId} onChange={(e) => setComplaintForm((f) => ({ ...f, clientPropertyId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <textarea placeholder="Description" value={complaintForm.description} onChange={(e) => setComplaintForm((f) => ({ ...f, description: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} required />
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      {showLeadForm && (
        <form onSubmit={submitLead} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Log Neighbor Lead</h2>
            <button type="button" onClick={() => setShowLeadForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <input type="text" placeholder="Name" value={leadForm.name} onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="tel" placeholder="Phone (optional)" value={leadForm.contactPhone} onChange={(e) => setLeadForm((f) => ({ ...f, contactPhone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input type="email" placeholder="Email (optional)" value={leadForm.contactEmail} onChange={(e) => setLeadForm((f) => ({ ...f, contactEmail: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <textarea placeholder="Notes" value={leadForm.notes} onChange={(e) => setLeadForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">Neighbor Complaints</h2>
        <div className="bg-white rounded-xl border divide-y">
          {complaints.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Home className="w-8 h-8 text-gray-300 mx-auto mb-2" /> None logged.
            </div>
          ) : (
            complaints.map((c) => (
              <div key={c.id} className="p-3 text-sm">
                <p className="text-brand-ink font-medium">{c.client_properties?.address ?? "(unknown address)"}</p>
                <p className="text-xs text-gray-500">{c.description}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">Neighbor Leads</h2>
        <div className="bg-white rounded-xl border divide-y">
          {leads.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">None logged.</div>
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
