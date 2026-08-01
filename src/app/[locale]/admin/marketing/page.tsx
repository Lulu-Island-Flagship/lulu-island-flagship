"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Megaphone, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface BlogPost {
  id: string;
  title: string;
  content: string;
  status: "draft" | "pending_approval" | "approved" | "published" | "rejected";
  source_trigger_type: string;
  source_sample_size: number;
  created_at: string;
}

export default function MarketingPage() {
  const t = useTranslations("admin.marketing");
  const STATUS_LABEL: Record<string, string> = {
    draft: t("status.draft"),
    pending_approval: t("status.pendingApproval"),
    approved: t("status.approved"),
    published: t("status.published"),
    rejected: t("status.rejected"),
  };
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
      if (!res.ok) throw new Error(json.error || t("errorLoading"));
      setPosts(json.posts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorUnknown"));
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
      if (!res.ok) throw new Error(json.error || t("errorRunningAction"));
      if (action === "evaluate") {
        setActionMsg(
          json.passed
            ? t("validationPassed")
            : t("validationFailed", {
                reasons: [...(json.evaluation?.reasons || []), ...(json.positioning?.violations || []).map((v: { reason: string }) => v.reason)].join(" | "),
              })
        );
      }
      await load();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : t("errorUnknown"));
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Megaphone className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        {t("intro")} {t("introFlagSuffix")}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}
      {actionMsg && <div className="text-sm mb-4 border rounded p-3 bg-gray-50">{actionMsg}</div>}

      {!loading && (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">{p.title || t("untitled")}</div>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
              <div className="text-xs text-gray-400 mb-2">
                {t("sourceSample", { source: p.source_trigger_type, sample: p.source_sample_size })}
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap border rounded p-3 bg-gray-50 mb-3 max-h-64 overflow-y-auto">
                {p.content || <span className="text-gray-400 italic">{t("noContent")}</span>}
              </div>
              <div className="flex gap-2">
                {p.status === "draft" && (
                  <button
                    onClick={() => runAction(p.id, "evaluate")}
                    className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50"
                  >
                    {t("evaluateAction")}
                  </button>
                )}
                {p.status === "pending_approval" && (
                  <>
                    <button
                      onClick={() => runAction(p.id, "approve")}
                      className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded"
                    >
                      {t("approve")}
                    </button>
                    <button
                      onClick={() => runAction(p.id, "reject")}
                      className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50"
                    >
                      {t("reject")}
                    </button>
                  </>
                )}
                {p.status === "approved" && (
                  <button
                    onClick={() => runAction(p.id, "publish")}
                    className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded"
                  >
                    {t("publish")}
                  </button>
                )}
              </div>
            </div>
          ))}
          {posts.length === 0 && <div className="text-gray-400 text-sm">{t("noPosts")}</div>}
        </div>
      )}
    </div>
  );
}
