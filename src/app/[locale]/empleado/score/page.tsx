"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Star,
  Shield,
  Award,
  AlertTriangle,
  XCircle,
  Minus,
  Trophy,
  TrendingUp,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { BADGE_CATALOG, type BadgeKey } from "@/lib/badges";
import { CAREER_LEVEL_ORDER, type CareerLevel } from "@/lib/career-path";

// v8.3 E8 FIX-1: la API (/api/empleado/score) ya no devuelve
// total_score/telemetry_score/audit_score/peer_score en crudo -- ver
// comentario en route.ts. Este shape refleja lo que realmente llega ahora.
interface ScoreRecord {
  id: string;
  week_start: string;
  trust_level: string;
  services_count: number;
  disputes_count: number;
}

interface Audit {
  id: string;
  order_id: string;
  score: number;
  criteria: Record<string, number>;
  notes: string;
  created_at: string;
  appealed_at: string | null;
  appeal_reason: string | null;
}

interface RecentService {
  order_id: string;
  status: string;
  created_at: string;
}

interface EarnedBadge {
  id: string;
  badge_key: BadgeKey;
  earned_at: string;
  evidence: string;
  employee_badge_bonuses: { bonus_cents: number }[] | { bonus_cents: number } | null;
}

interface NextLevelInfo {
  level: CareerLevel;
  eligible: boolean;
  checks: { label: string; passed: boolean }[];
  unverifiableBySystem: string[];
}

interface EmployeeScoreData {
  employee: {
    id: string;
    name: string;
    trust_level: string;
    career_level: CareerLevel;
    career_level_since: string;
  };
  scores: ScoreRecord[];
  audits: Audit[];
  recentServices: RecentService[];
  badges: EarnedBadge[];
  nextLevel: NextLevelInfo | null;
}

const CAREER_LEVEL_LABEL: Record<CareerLevel, string> = {
  trabajador: "Team Member",
  senior: "Senior",
  lider: "Team Lead",
  lider_mentor: "Lead Mentor",
  coordinador_operativo: "Operations Coordinator",
};

export default function EmpleadoScorePage() {
  const params = useParams();
  // 2026-07-24: antes el href de "Back" leía window.location.pathname
  // inline, lo que causaba un hydration mismatch (SSR asumía "en", cliente
  // calculaba el locale real) -- ver auditoría externa. useParams() da el
  // mismo valor en servidor y cliente porque viene del router de Next.
  const locale = (params?.locale as string) || "en";
  const [data, setData] = useState<EmployeeScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [appealError, setAppealError] = useState("");
  const [appealSuccess, setAppealSuccess] = useState("");

  useEffect(() => {
    loadScore();
  }, []);

  async function loadScore() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/score", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load score");
        setLoading(false);
        return;
      }
      const d = await res.json();
      setData(d);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitAppeal(auditId: string) {
    if (!appealReason.trim()) {
      setAppealError("Reason is required");
      return;
    }
    setSubmittingAppeal(true);
    setAppealError("");
    setAppealSuccess("");
    try {
      const res = await fetch("/api/empleado/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ auditId, reason: appealReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setAppealError(err.error || "Failed to submit appeal");
        setSubmittingAppeal(false);
        return;
      }
      setAppealSuccess("Appeal submitted successfully");
      setAppealReason("");
      setSelectedAudit(null);
      loadScore();
    } catch {
      setAppealError("Network error");
    } finally {
      setSubmittingAppeal(false);
    }
  }

  const getTrustLevelIcon = (level: string) => {
    switch (level) {
      case "elite":
        return <Award className="w-5 h-5 text-purple-600" />;
      case "standard":
        return <Shield className="w-5 h-5 text-blue-600" />;
      case "observation":
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case "suspended":
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Minus className="w-5 h-5 text-gray-400" />;
    }
  };

  const getTrustLevelColor = (level: string) => {
    switch (level) {
      case "elite":
        return "text-purple-600 bg-purple-50";
      case "standard":
        return "text-blue-600 bg-blue-50";
      case "observation":
        return "text-yellow-600 bg-yellow-50";
      case "suspended":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  // v8.3 E8 FIX-1: sin número visible al empleado para el score AGREGADO
  // (semanal/competitivo). field_audits.score/100 más abajo es distinto:
  // es el resultado de UNA auditoría puntual que el empleado necesita ver
  // para decidir si apela dentro de las 72h -- sin ese número la apelación
  // no tendría contexto. Se mantiene solo ahí, nunca como score agregado.
  const getAuditScoreColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-blue-600";
    if (score >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  const TRUST_LEVEL_LABEL: Record<string, string> = {
    elite: "Élite",
    standard: "Estándar",
    observation: "Observación",
    suspended: "Suspendido",
  };

  const latestScore = data?.scores?.[0];

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-brand-gold" />
            <span className="font-semibold text-sm">My Score</span>
          </div>
          <a
            href={`/${locale}/empleado`}
            className="text-sm text-gray-300 hover:text-white transition-colors"
          >
            Back
          </a>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        ) : data ? (
          <>
            {/* Score Card */}
            <div className="bg-white rounded-xl shadow-elevation-1 p-6 text-center">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${getTrustLevelColor(data.employee.trust_level)}`}>
                {getTrustLevelIcon(data.employee.trust_level)}
                {TRUST_LEVEL_LABEL[data.employee.trust_level] || data.employee.trust_level}
              </div>

              <p className="text-sm text-gray-500 mt-3">Your current standing level</p>

              <div className="mt-4 text-xs text-gray-400">
                <p>Week of {latestScore?.week_start || "—"}</p>
                <p>{latestScore?.services_count || 0} services · {latestScore?.disputes_count || 0} disputes</p>
              </div>
            </div>

            {/* Career Path */}
            <div className="bg-white rounded-xl shadow-elevation-1 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-brand-wave-blue" />
                <h2 className="text-sm font-semibold text-brand-ink">Career Path</h2>
              </div>
              <div className="flex items-center flex-wrap gap-1">
                {CAREER_LEVEL_ORDER.map((level, idx) => {
                  const currentIdx = CAREER_LEVEL_ORDER.indexOf(data.employee.career_level);
                  const reached = idx <= currentIdx;
                  return (
                    <React.Fragment key={level}>
                      {idx > 0 && <span className="text-gray-300 text-xs">→</span>}
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          level === data.employee.career_level
                            ? "bg-brand-navy text-white"
                            : reached
                            ? "bg-brand-navy/10 text-brand-navy"
                            : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {CAREER_LEVEL_LABEL[level]}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Current level since {new Date(data.employee.career_level_since).toLocaleDateString()}
              </p>

              {data.nextLevel && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-brand-ink mb-2">
                    Next: {CAREER_LEVEL_LABEL[data.nextLevel.level]}
                  </p>
                  {data.nextLevel.checks.length > 0 && (
                    <ul className="space-y-1 mb-2">
                      {data.nextLevel.checks.map((c) => (
                        <li key={c.label} className="flex items-center gap-2 text-xs">
                          {c.passed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-state-success shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                          )}
                          <span className={c.passed ? "text-brand-ink" : "text-gray-500"}>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.nextLevel.unverifiableBySystem.length > 0 && (
                    <div className="text-xs text-gray-500">
                      <p className="mb-1">Also required (confirmed by admin):</p>
                      <ul className="space-y-1">
                        {data.nextLevel.unverifiableBySystem.map((req) => (
                          <li key={req} className="flex items-center gap-2">
                            <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <span>{req}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Badges */}
            <div>
              <h2 className="text-lg font-semibold text-brand-ink mb-3">Badges</h2>
              {data.badges.length === 0 ? (
                <div className="bg-white rounded-xl shadow-elevation-1 p-5 text-center text-sm text-gray-400">
                  No badges earned yet. Keep up the great work!
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {data.badges.map((b) => {
                    const def = BADGE_CATALOG[b.badge_key];
                    const bonusEntry = Array.isArray(b.employee_badge_bonuses)
                      ? b.employee_badge_bonuses[0]
                      : b.employee_badge_bonuses;
                    return (
                      <div key={b.id} className="bg-white rounded-xl shadow-elevation-1 p-4 flex items-start gap-3">
                        <Trophy className="w-5 h-5 text-brand-gold shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-brand-ink">{def?.name || b.badge_key}</p>
                            {bonusEntry && bonusEntry.bonus_cents > 0 && (
                              <span className="text-xs font-medium text-state-success">
                                +${(bonusEntry.bonus_cents / 100).toFixed(2)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{b.evidence}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(b.earned_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Weekly History — nivel cualitativo, nunca número (v8.3 E8 FIX-1) */}
            {data.scores.length > 1 && (
              <div>
                <h2 className="text-lg font-semibold text-brand-ink mb-3">Weekly History</h2>
                <div className="space-y-2">
                  {data.scores.slice(1).map((score) => (
                    <div key={score.id} className="bg-white rounded-xl shadow-elevation-1 p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-brand-ink">Week of {score.week_start}</p>
                        <p className="text-xs text-gray-400">
                          {score.services_count} services · {score.disputes_count} disputes
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${getTrustLevelColor(score.trust_level)}`}>
                        {TRUST_LEVEL_LABEL[score.trust_level] || score.trust_level}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Audits */}
            {data.audits.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-brand-ink mb-3">Recent Audits</h2>
                <div className="space-y-2">
                  {data.audits.map((audit) => (
                    <div key={audit.id} className="bg-white rounded-xl shadow-elevation-1 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${getAuditScoreColor(audit.score)}`}>
                            {audit.score}/100
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(audit.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {!audit.appealed_at && (
                          <button
                            onClick={() => {
                              setSelectedAudit(audit);
                              setAppealReason("");
                              setAppealError("");
                              setAppealSuccess("");
                            }}
                            className="text-xs text-brand-navy font-medium hover:underline"
                          >
                            Appeal
                          </button>
                        )}
                        {audit.appealed_at && (
                          <span className="text-xs text-amber-600 font-medium">Appealed</span>
                        )}
                      </div>
                      {audit.notes && (
                        <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg p-2">{audit.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Services */}
            {data.recentServices.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-brand-ink mb-3">Recent Services</h2>
                <div className="space-y-2">
                  {data.recentServices.map((svc) => (
                    <div key={svc.order_id} className="bg-white rounded-xl shadow-elevation-1 p-4 flex items-center justify-between">
                      <span className="text-sm text-brand-ink">Order {svc.order_id.slice(0, 8)}...</span>
                      <span className="text-xs text-gray-400 capitalize">{svc.status.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Appeal Modal */}
      {selectedAudit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">Appeal Audit</h2>
              <button
                onClick={() => setSelectedAudit(null)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600">
              You have <strong>72 hours</strong> from the audit date to appeal. 
              The appeal log is immutable and will be reviewed by a supervisor.
            </p>

            <div className="text-sm bg-gray-50 rounded-lg p-3">
              <p><strong>Audit Score:</strong> {selectedAudit.score}/100</p>
              <p><strong>Date:</strong> {new Date(selectedAudit.created_at).toLocaleDateString()}</p>
            </div>

            <textarea
              aria-label="Razón de la apelación de auditoría"
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="Explain why you believe this audit is unfair..."
              className="w-full border rounded-lg p-3 text-sm min-h-[100px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
            />

            {appealError && <p className="text-sm text-red-600">{appealError}</p>}
            {appealSuccess && <p className="text-sm text-green-600">{appealSuccess}</p>}

            <button
              onClick={() => submitAppeal(selectedAudit.id)}
              disabled={submittingAppeal}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {submittingAppeal ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Appeal"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
