"use client";

import React, { useEffect, useState } from "react";
import { Loader2, FlaskConical, Plus, X, PlayCircle, UserPlus, Trophy } from "lucide-react";

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
  const [evaluateTarget, setEvaluateTarget] = useState<Experiment | null>(null);
  const [evaluateForm, setEvaluateForm] = useState<
    { variant: string; sampleSize: string; conversionRate: string; marginRatio: string }[]
  >([]);
  const [confidenceInput, setConfidenceInput] = useState("96");
  const [evaluateResult, setEvaluateResult] = useState<{ hasWinner: boolean; winner?: string; reason: string } | null>(null);
  const [evaluateError, setEvaluateError] = useState("");
  const [evaluating, setEvaluating] = useState(false);
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

  function openEvaluate(exp: Experiment) {
    setEvaluateTarget(exp);
    setEvaluateForm(
      exp.variants.map((v) => ({ variant: v.name, sampleSize: "", conversionRate: "", marginRatio: "" }))
    );
    setConfidenceInput("96");
    setEvaluateResult(null);
    setEvaluateError("");
  }

  async function submitEvaluate(e: React.FormEvent) {
    e.preventDefault();
    if (!evaluateTarget) return;
    setEvaluating(true);
    setEvaluateError("");
    setEvaluateResult(null);
    try {
      const outcomes = evaluateForm.map((f) => ({
        variant: f.variant,
        sampleSize: Number(f.sampleSize) || 0,
        conversionRate: Number(f.conversionRate) / 100,
        marginRatio: Number(f.marginRatio) / 100,
      }));
      const confidence = Number(confidenceInput) / 100;
      const res = await fetch(`/api/admin/experiments/${evaluateTarget.id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ outcomes, confidence }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEvaluateError(data.error || "Failed to evaluate experiment");
        return;
      }
      setEvaluateResult(data.result);
      if (data.result?.hasWinner) {
        await load();
      }
    } catch {
      setEvaluateError("Network error");
    } finally {
      setEvaluating(false);
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
          <input type="text" aria-label="Nombre del experimento" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <select aria-label="Tipo de experimento" value={form.experimentType} onChange={(e) => setForm((f) => ({ ...f, experimentType: e.target.value as ExperimentType }))} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="price">Price</option>
            <option value="copy">Copy</option>
            <option value="ui_ux">UI/UX</option>
            <option value="batch_schedule">Batch schedule</option>
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input type="number" aria-label="Porcentaje de control" min={80} max={99} placeholder="Control %" value={form.controlWeight} onChange={(e) => setForm((f) => ({ ...f, controlWeight: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" required />
            <input type="number" aria-label="Porcentaje de variante" min={1} max={20} placeholder="Variant %" value={form.variantWeight} onChange={(e) => setForm((f) => ({ ...f, variantWeight: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" required />
          </div>
          <p className="text-xs text-gray-400">Variant must stay under 20% of traffic; percentages must add to 100.</p>
          <button type="submit" aria-label="Crear experimento" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
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
          <input type="text" aria-label="ID de usuario del cliente" placeholder="Client user ID" value={assignClientId} onChange={(e) => setAssignClientId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <button type="submit" aria-label="Asignar cliente al experimento" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Assigning..." : "Assign"}
          </button>
        </form>
      )}

      {evaluateTarget && (
        <form onSubmit={submitEvaluate} className="bg-white rounded-xl border p-4 space-y-3 max-w-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Mark winner — {evaluateTarget.name}</h2>
            <button type="button" onClick={() => setEvaluateTarget(null)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <p className="text-xs text-gray-500">
            Enter observed results per variant. Confidence must be pre-computed (z-test or equivalent) outside this form.
          </p>
          {evaluateForm.map((f, idx) => (
            <div key={f.variant} className="grid grid-cols-4 gap-2 items-center">
              <span className="text-xs font-medium text-brand-ink truncate">{f.variant}</span>
              <input
                type="number"
                aria-label={`Sample size for ${f.variant}`}
                placeholder="Sample size"
                value={f.sampleSize}
                onChange={(e) => {
                  const v = e.target.value;
                  setEvaluateForm((prev) => prev.map((row, i) => (i === idx ? { ...row, sampleSize: v } : row)));
                }}
                className="border rounded-lg px-2 py-1.5 text-sm"
                required
              />
              <input
                type="number"
                aria-label={`Conversion rate % for ${f.variant}`}
                placeholder="Conv. %"
                value={f.conversionRate}
                onChange={(e) => {
                  const v = e.target.value;
                  setEvaluateForm((prev) => prev.map((row, i) => (i === idx ? { ...row, conversionRate: v } : row)));
                }}
                className="border rounded-lg px-2 py-1.5 text-sm"
                required
              />
              <input
                type="number"
                aria-label={`Margin ratio % for ${f.variant}`}
                placeholder="Margin %"
                value={f.marginRatio}
                onChange={(e) => {
                  const v = e.target.value;
                  setEvaluateForm((prev) => prev.map((row, i) => (i === idx ? { ...row, marginRatio: v } : row)));
                }}
                className="border rounded-lg px-2 py-1.5 text-sm"
                required
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Confidence %</label>
            <input
              type="number"
              aria-label="Statistical confidence percentage"
              value={confidenceInput}
              onChange={(e) => setConfidenceInput(e.target.value)}
              className="border rounded-lg px-2 py-1.5 text-sm w-24"
              required
            />
          </div>
          {evaluateError && <p className="text-xs text-red-600">{evaluateError}</p>}
          {evaluateResult && (
            <div className={`rounded-lg p-3 text-xs ${evaluateResult.hasWinner ? "bg-green-50 text-green-700 border border-green-200" : "bg-yellow-50 text-yellow-800 border border-yellow-200"}`}>
              {evaluateResult.reason}
            </div>
          )}
          <button type="submit" aria-label="Evaluar experimento y marcar ganador" disabled={evaluating} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {evaluating ? "Evaluating..." : "Evaluate"}
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
                  <>
                    <button onClick={() => setAssignTarget(exp.id)} className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
                      <UserPlus className="w-3.5 h-3.5" /> Assign client
                    </button>
                    <button onClick={() => openEvaluate(exp)} className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
                      <Trophy className="w-3.5 h-3.5" /> Mark winner
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
