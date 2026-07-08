"use client";

/**
 * v8.3 E0-C6 — Historial de configuración con botón Deshacer (invariante B.2.10).
 * Muestra cada snapshot (qué cambió, quién, por qué, cuándo) y permite revertirlo.
 * Solo owner_admin (la API lo exige).
 */

import React, { useState, useEffect } from "react";
import { Loader2, Undo2, History } from "lucide-react";

interface Snapshot {
  id: string;
  table_name: string;
  row_id: string;
  values_before: Record<string, unknown>;
  values_after: Record<string, unknown>;
  reason: string;
  changed_by: string | null;
  created_at: string;
  undone_at: string | null;
}

function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== "updated_at" && k !== "updated_by"
  );
}

export default function ConfigHistoryPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [undoing, setUndoing] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const url = tableFilter
        ? `/api/admin/config-history?table=${encodeURIComponent(tableFilter)}`
        : "/api/admin/config-history";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error cargando historial");
      setSnapshots(json.snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function undo(id: string) {
    if (!confirm("¿Deshacer este cambio? Se restauran los valores anteriores (el undo también queda registrado).")) return;
    setUndoing(id);
    setError("");
    try {
      const res = await fetch("/api/admin/config-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error deshaciendo");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setUndoing(null);
    }
  }

  const tables = Array.from(new Set(snapshots.map((s) => s.table_name)));

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-3">
        <History className="h-6 w-6 text-brand-navy" />
        <h1 className="text-2xl font-semibold text-brand-navy">Historial de configuración</h1>
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="ml-auto rounded-md border border-brand-ice px-3 py-1.5 text-sm"
        >
          <option value="">Todas las tablas</option>
          {tables.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-navy" />
        </div>
      ) : snapshots.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">
          Sin cambios de configuración registrados todavía.
        </p>
      ) : (
        <div className="space-y-3">
          {snapshots.map((s) => {
            const changed = diffKeys(s.values_before, s.values_after);
            return (
              <div
                key={s.id}
                className={`rounded-lg border bg-white p-4 shadow-elevation-1 ${
                  s.undone_at ? "border-gray-200 opacity-60" : "border-brand-ice"
                }`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <code className="rounded bg-brand-ice px-1.5 py-0.5 text-xs">{s.table_name}</code>
                  <span className="text-gray-400">
                    {new Date(s.created_at).toLocaleString("es-CA", { timeZone: "America/Vancouver" })}
                  </span>
                  {s.undone_at && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">DESHECHO</span>
                  )}
                  {!s.undone_at && (
                    <button
                      onClick={() => undo(s.id)}
                      disabled={undoing === s.id}
                      className="ml-auto flex items-center gap-1 rounded-md border border-brand-navy px-3 py-1 text-xs text-brand-navy hover:bg-brand-ice"
                    >
                      {undoing === s.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3" />
                      )}
                      Deshacer
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm text-brand-ink">{s.reason}</p>
                <div className="mt-2 space-y-0.5">
                  {changed.map((k) => (
                    <p key={k} className="text-xs text-gray-600">
                      <code>{k}</code>:{" "}
                      <span className="text-state-danger line-through">
                        {JSON.stringify(s.values_before[k])}
                      </span>{" "}
                      → <span className="text-state-success">{JSON.stringify(s.values_after[k])}</span>
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
