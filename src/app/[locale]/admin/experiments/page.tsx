"use client";

import React, { useEffect, useState } from "react";
import { Loader2, FlaskConical, Plus, X, PlayCircle, UserPlus } from "lucide-react";

type ExperimentType = "price" | "copy" | "ui_ux" | "batch_schedule";

interface Experiment {
  id: string;
  name: string;
  experiment_type: ExperimentType;
  variants: { name: string; weight: number }[];
  status: "draft" | "running" | "completed";
  winner: string | null;
  winner_reason: string | null;
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignClientId, setAssignClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    experimentType: "price" as ExperimentType,
    controlWeight: "90",
    variantWeight: "10",
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/experiments", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      setExperiments((await res.json()).experiments || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const controlW = Number(form.controlWeight) / 100;
      const variantW = Number(form.variantWeight) / 100;
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "create",
          name: form.name.trim(),
          experimentType: form.experimentType,
          variants: [
            { name: "control", weight: controlW },
            { name: "variant_a", weight: variantW },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      setShowForm(false);
      setForm({ name: "", experimentType: "price", controlWeight: "90", variantWeight: "10" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function startExperiment(id: string) {
    await fetch("/api/admin/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "start", id }),
    });
    await load();
  }

  async function submitAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTarget) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/experiments/${assignTarget}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientUserId: assignClientId.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      setAssignTarget(null);
      setAssignClientId("");
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
          <h1 className="text-2xl font-bold text-brand-ink">A/B Experiments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recurring clients are always excluded. Winner is calculated, never picked by hand.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Experiment
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={submitCreate} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">New Experiment</h2>
            <button type="button" onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <input type="text" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <select value={form.experimentType} onChange={(e) => setForm((f) => ({ ...f, experimentType: e.target.value as ExperimentType }))} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="price">Price</option>
            <option value="copy">Copy</option>
            <option value="ui_ux">UI/UX</option>
            <option value="batch_schedule">Batch schedule</option>
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input type="number" min={80} max={99} placeholder="Control %" value={form.controlWeight} onChange={(e) => setForm((f) => ({ ...f, controlWeight: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" required />
            <input type="number" min={1} max={20} placeholder="Variant %" value={form.variantWeight} onChange={(e) => setForm((f) => ({ ...f, variantWeight: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" required />
          </div>
          <p className="text-xs text-gray-400">Variant must stay under 20% of traffic; percentages must add to 100.</p>
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Create"}
          </button>
        </form>
      )}

      {assignTarget && (
        <form onSubmit={submitAssign} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Assign Client</h2>
            <button type="button" onClick={() => setAssignTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <input type="text" placeholder="Client user ID" value={assignClientId} onChange={(e) => setAssignClientId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Assigning..." : "Assign"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {experiments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <FlaskConical className="w-8 h-8 text-gray-300 mx-auto mb-2" /> No experiments yet.
          </div>
        ) : (
          experiments.map((exp) => (
            <div key={exp.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-brand-ink text-sm">{exp.name}</p>
                <span className="text-xs text-gray-400">{exp.status}</span>
              </div>
              <p className="text-xs text-gray-500">
                {exp.variants.map((v) => `${v.name} (${(v.weight * 100).toFixed(0)}%)`).join(" vs. ")}
              </p>
              {exp.winner && <p className="text-xs text-state-success">Winner: {exp.winner} — {exp.winner_reason}</p>}
              <div className="flex gap-3">
                {exp.status === "draft" && (
                  <button onClick={() => startExperiment(exp.id)} className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
                    <PlayCircle className="w-3.5 h-3.5" /> Start
                  </button>
                )}
                {exp.status === "running" && (
                  <button onClick={() => setAssignTarget(exp.id)} className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
                    <UserPlus className="w-3.5 h-3.5" /> Assign client
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
