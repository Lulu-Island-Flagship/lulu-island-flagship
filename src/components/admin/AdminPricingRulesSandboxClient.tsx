"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Play,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Flag,
} from "lucide-react";
import { type PricingRule, type AppliedRule } from "@/lib/rules";

interface SimulationResultItem {
  name: string;
  basePrice: number;
  subtotal: number;
  finalSubtotal: number;
  adjustment: number;
  appliedRules: AppliedRule[];
  blocked: boolean;
  blockReason?: string;
  flagged: boolean;
  flagReason?: string;
  baseline?: {
    finalSubtotal: number;
    adjustment: number;
    appliedRules: AppliedRule[];
    blocked: boolean;
    flagged: boolean;
  };
  diff?: number;
}

interface SimulationResponse {
  mode: "shadow" | "production";
  candidateRulesCount: number;
  baselineRulesCount: number;
  quoteCasesCount: number;
  syntheticCasesCount: number;
  results: SimulationResultItem[];
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

function normalizeRule(raw: PricingRule): PricingRule {
  return {
    ...raw,
    conditionJson: (raw as unknown as { condition_json?: PricingRule["conditionJson"] }).condition_json || raw.conditionJson,
    isActive: (raw as unknown as { is_active?: boolean }).is_active ?? raw.isActive,
    maxApplicable: (raw as unknown as { max_applicable?: boolean }).max_applicable ?? raw.maxApplicable,
    actionType: (raw as unknown as { action_type?: PricingRule["actionType"] }).action_type || raw.actionType,
    actionValue: (raw as unknown as { action_value?: number }).action_value ?? raw.actionValue,
    priority: (raw as unknown as { priority?: number }).priority ?? raw.priority,
  };
}

export default function AdminPricingRulesSandboxClient() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [shadowMode, setShadowMode] = useState(true);
  const [includeSynthetic, setIncludeSynthetic] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResponse | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pricing-rules", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load pricing rules");
        return;
      }
      const data = await res.json();
      const normalized = ((data.rules || []) as PricingRule[]).map(normalizeRule);
      setRules(normalized);
      setSelectedRuleIds(new Set(normalized.filter((r) => r.isActive).map((r) => r.id)));
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation() {
    setRunning(true);
    setError("");
    try {
      const candidateRules = rules.filter((r) => selectedRuleIds.has(r.id));
      const payload: Record<string, unknown> = {
        shadow: shadowMode,
        rules: candidateRules,
        syntheticCases: includeSynthetic ? undefined : [],
      };

      const res = await fetch("/api/admin/pricing-rules/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Simulation failed");
        return;
      }

      const data = (await res.json()) as SimulationResponse;
      setResult(data);
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  const stats = useMemo(() => {
    if (!result) return null;
    const affected = result.results.filter((r) => r.adjustment !== 0 || r.blocked || r.flagged);
    const diffs = result.results.map((r) => r.diff ?? 0);
    const totalDiff = diffs.reduce((a, b) => a + b, 0);
    const avgDiff = result.results.length ? totalDiff / result.results.length : 0;
    const blockedCount = result.results.filter((r) => r.blocked).length;
    const flaggedCount = result.results.filter((r) => r.flagged).length;
    return { affectedCount: affected.length, totalDiff, avgDiff, blockedCount, flaggedCount };
  }, [result]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">Pricing Rules Sandbox</h1>
          <p className="text-sm text-gray-500">Simulate rule changes against historical quotes before going live.</p>
        </div>
        <a
          href="../pricing-rules"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-navy hover:text-brand-navy/80"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to rules
        </a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-brand-ink">Candidate rules</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedRuleIds(new Set(rules.filter((r) => r.isActive).map((r) => r.id)))}
              className="text-xs font-medium text-brand-navy hover:underline"
            >
              Select active
            </button>
            <button
              onClick={() => setSelectedRuleIds(new Set())}
              className="text-xs font-medium text-gray-500 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-gray-500">No rules available. Create one first.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2">
            {rules.map((rule) => (
              <label
                key={rule.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  aria-label={`Seleccionar regla ${rule.name}`}
                  checked={selectedRuleIds.has(rule.id)}
                  onChange={(e) => {
                    const next = new Set(selectedRuleIds);
                    if (e.target.checked) next.add(rule.id);
                    else next.delete(rule.id);
                    setSelectedRuleIds(next);
                  }}
                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-brand-navy focus:ring-brand-gold"
                />
                <div className="text-sm">
                  <div className="font-medium text-brand-ink">{rule.name}</div>
                  <div className="text-xs text-gray-500">
                    {rule.actionType}
                    {rule.actionValue !== undefined && rule.actionValue !== null ? ` ${rule.actionValue}` : ""} — priority{" "}
                    {rule.priority}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              aria-label="Modo sombra (comparar con las reglas actualmente activas)"
              checked={shadowMode}
              onChange={(e) => setShadowMode(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-gold"
            />
            Shadow mode (compare against currently active rules)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              aria-label="Incluir escenarios sintéticos"
              checked={includeSynthetic}
              onChange={(e) => setIncludeSynthetic(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-gold"
            />
            Include synthetic scenarios
          </label>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={runSimulation}
            disabled={running || selectedRuleIds.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run simulation
          </button>
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Mode</div>
              <div className="text-sm font-semibold text-brand-ink capitalize">{result.mode}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Cases</div>
              <div className="text-sm font-semibold text-brand-ink">
                {result.quoteCasesCount} quotes + {result.syntheticCasesCount} synthetic
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Affected cases</div>
              <div className="text-sm font-semibold text-brand-ink">{stats?.affectedCount ?? 0}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Avg diff</div>
              <div
                className={`text-sm font-semibold ${
                  (stats?.avgDiff ?? 0) > 0 ? "text-green-600" : (stats?.avgDiff ?? 0) < 0 ? "text-red-600" : "text-brand-ink"
                }`}
              >
                {formatCurrency(stats?.avgDiff ?? 0)}
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Blocks / Flags</div>
              <div className="text-sm font-semibold text-brand-ink">
                {stats?.blockedCount ?? 0} / {stats?.flaggedCount ?? 0}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Case</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Subtotal</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Adjustment</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Final</th>
                    {shadowMode && result.mode === "shadow" && (
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Baseline / Diff</th>
                    )}
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Applied rules</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.results.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-brand-ink max-w-xs truncate" title={r.name}>
                          {r.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600">{formatCurrency(r.subtotal)}</td>
                      <td className="px-4 py-3 align-top">
                        <span className={r.adjustment > 0 ? "text-green-600" : r.adjustment < 0 ? "text-red-600" : "text-gray-600"}>
                          {formatCurrency(r.adjustment)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top font-medium text-brand-ink">
                        {formatCurrency(r.finalSubtotal)}
                      </td>
                      {shadowMode && result.mode === "shadow" && (
                        <td className="px-4 py-3 align-top">
                          {r.baseline ? (
                            <div className="text-xs">
                              <div className="text-gray-600">{formatCurrency(r.baseline.finalSubtotal)}</div>
                              <div
                                className={`font-medium ${
                                  (r.diff ?? 0) > 0 ? "text-green-600" : (r.diff ?? 0) < 0 ? "text-red-600" : "text-gray-500"
                                }`}
                              >
                                {r.diff && r.diff > 0 ? "+" : ""}
                                {formatCurrency(r.diff ?? 0)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 align-top">
                        {r.appliedRules.length === 0 ? (
                          <span className="text-xs text-gray-400">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.appliedRules.map((ar, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px]"
                                title={`${ar.actionType} ${ar.actionValue ?? ""}`}
                              >
                                {ar.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-1.5">
                          {r.blocked ? (
                            <>
                              <XCircle className="w-4 h-4 text-red-500" />
                              <span className="text-xs text-red-600">Blocked</span>
                            </>
                          ) : r.flagged ? (
                            <>
                              <Flag className="w-4 h-4 text-amber-500" />
                              <span className="text-xs text-amber-600">Flagged</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                              <span className="text-xs text-gray-500">OK</span>
                            </>
                          )}
                        </div>
                        {r.blockReason && <div className="text-[10px] text-red-600 mt-1 max-w-xs">{r.blockReason}</div>}
                        {r.flagReason && <div className="text-[10px] text-amber-600 mt-1 max-w-xs">{r.flagReason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
