"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Megaphone, Loader2 } from "lucide-react";

interface BlogPost {
  id: string;
  title: string;
  content: string;
  status: "draft" | "pending_approval" | "approved" | "published" | "rejected";
  source_trigger_type: string;
  source_sample_size: number;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobado",
  published: "Publicado",
  rejected: "Rechazado",
};

export default function MarketingPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error cargando marketing");
      setPosts(json.posts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (id: string, action: string) => {
    setActionMsg(null);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error en la acción");
      if (action === "evaluate") {
        setActionMsg(
          json.passed
            ? "Validación PIPA + posicionamiento: OK. Post movido a pendiente de aprobación."
            : `Validación falló: ${[...(json.evaluation?.reasons || []), ...(json.positioning?.violations || []).map((v: { reason: string }) => v.reason)].join(" | ")}`
        );
      }
      await load();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Error desconocido");
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Megaphone className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Marketing — contenido educativo (blog)</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Todo post pasa por el validador PIPA (B.2.20) y el validador de coherencia de posicionamiento
        (B.2.24/B.2.25) antes de poder aprobarse. &quot;Asegurados/bonded&quot; se bloquea automáticamente
        mientras el flag <code>pólizas_seguro</code> esté apagado.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}
      {actionMsg && <div className="text-sm mb-4 border rounded p-3 bg-gray-50">{actionMsg}</div>}

      {!loading && (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">{p.title || "(sin título)"}</div>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
              <div className="text-xs text-gray-400 mb-2">
                Origen: {p.source_trigger_type} · muestra={p.source_sample_size}
              </div>
              <div className="flex gap-2">
                {p.status === "draft" && (
                  <button
                    onClick={() => runAction(p.id, "evaluate")}
                    className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50"
                  >
                    Evaluar (PIPA + posicionamiento)
                  </button>
                )}
                {p.status === "pending_approval" && (
                  <>
                    <button
                      onClick={() => runAction(p.id, "approve")}
                      className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => runAction(p.id, "reject")}
                      className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50"
                    >
                      Rechazar
                    </button>
                  </>
                )}
                {p.status === "approved" && (
                  <button
                    onClick={() => runAction(p.id, "publish")}
                    className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded"
                  >
                    Publicar
                  </button>
                )}
              </div>
            </div>
          ))}
          {posts.length === 0 && <div className="text-gray-400 text-sm">Sin posts registrados.</div>}
        </div>
      )}
    </div>
  );
}
