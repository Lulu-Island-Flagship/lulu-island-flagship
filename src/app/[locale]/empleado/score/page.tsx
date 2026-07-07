"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Shield,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Award,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Star,
} from "lucide-react";

interface ScoreRecord {
  week_start: string;
  total_score: number;
  telemetry_score: number;
  audit_score: number;
  peer_score: number;
  trust_level: string;
  services_count: number;
  disputes_count: number;
}

interface AuditRecord {
  id: string;
  score: number;
  criteria: Record<string, number>;
  notes: string;
  created_at: string;
  appealed_at: string | null;
  appeal_reason: string | null;
}

interface EmployeeData {
  id: string;
  name: string;
  trust_level: string;
}

export default function EmpleadoScorePage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/empleado/score", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/empleado");
        }
        return;
      }
      const data = await res.json();
      setEmployee(data.employee);
      setScores(data.scores || []);
      setAudits(data.audits || []);
    } catch (e) {
      console.error("Load score error:", e);
    } finally {
      setLoading(false);
    }
  }

  const getTrustBadge = (level: string) => {
    switch (level) {
      case "elite":
        return <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1"><Award className="w-3 h-3" />Elite</span>;
      case "standard":
        return <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-medium">Standard</span>;
      case "observation":
        return <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Observation</span>;
      case "suspended":
        return <span className="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1"><XCircle className="w-3 h-3" />Suspended</span>;
      default:
        return null;
    }
  };

  const getScoreTrend = (current: number, previous: number) => {
    if (current > previous) return <TrendingUp className="w-4 h-4 text-state-success" />;
    if (current < previous) return <TrendingDown className="w-4 h-4 text-state-danger" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const latestScore = scores[0];
  const previousScore = scores[1];

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push("/empleado")} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-gold" />
            <div>
              <h1 className="font-semibold">My Score</h1>
              {employee && <p className="text-xs text-gray-400">{employee.name}</p>}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <>
            {/* Current Score Card */}
            {latestScore && (
              <div className="bg-white rounded-xl shadow-elevation-1 p-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {getTrustBadge(latestScore.trust_level)}
                </div>
                <div className="text-5xl font-bold text-brand-ink mb-1">
                  {latestScore.total_score}
                </div>
                <p className="text-sm text-gray-500 mb-3">out of 100</p>
                {previousScore && (
                  <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
                    {getScoreTrend(latestScore.total_score, previousScore.total_score)}
                    <span>vs last week ({previousScore.total_score})</span>
                  </div>
                )}
              </div>
            )}

            {/* Score Breakdown */}
            {latestScore && (
              <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-4">
                <h2 className="font-semibold text-brand-ink text-sm">Score Breakdown</h2>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">Telemetry (50%)</span>
                      <span className="font-medium">{latestScore.telemetry_score}/50</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-navy rounded-full transition-all"
                        style={{ width: `${(latestScore.telemetry_score / 50) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">Field Audits (30%)</span>
                      <span className="font-medium">{latestScore.audit_score}/30</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-gold rounded-full transition-all"
                        style={{ width: `${(latestScore.audit_score / 30) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">Peer Votes (20%)</span>
                      <span className="font-medium">{latestScore.peer_score}/20</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-state-success rounded-full transition-all"
                        style={{ width: `${(latestScore.peer_score / 20) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-brand-ink">{latestScore.services_count}</p>
                    <p className="text-xs text-gray-500">Services</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-state-danger">{latestScore.disputes_count}</p>
                    <p className="text-xs text-gray-500">Disputes</p>
                  </div>
                </div>
              </div>
            )}

            {/* Trust Level Info */}
            <div className="bg-white rounded-xl shadow-elevation-1 p-5">
              <h2 className="font-semibold text-brand-ink text-sm mb-3">Trust Levels</h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                  <Award className="w-4 h-4 text-purple-600" />
                  <div className="flex-1">
                    <span className="font-medium text-purple-700">Elite (90-100)</span>
                    <p className="text-xs text-purple-600">Auto-approval QC, 10% sampling</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <div className="flex-1">
                    <span className="font-medium text-blue-700">Standard (70-89)</span>
                    <p className="text-xs text-blue-600">QC wall required for every service</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <div className="flex-1">
                    <span className="font-medium text-amber-700">Observation (50-69)</span>
                    <p className="text-xs text-amber-600">QC + extra photo required</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <div className="flex-1">
                    <span className="font-medium text-red-700">Suspended (&lt;50)</span>
                    <p className="text-xs text-red-600">Re-training required, no solo services</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Audits */}
            {audits.length > 0 && (
              <div className="bg-white rounded-xl shadow-elevation-1 p-5">
                <h2 className="font-semibold text-brand-ink text-sm mb-3">Recent Field Audits</h2>
                <div className="space-y-3">
                  {audits.slice(0, 5).map((audit) => (
                    <div key={audit.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1">
                          <Star className={`w-4 h-4 ${audit.score >= 4 ? "text-yellow-400 fill-current" : audit.score >= 3 ? "text-brand-gold" : "text-red-400"}`} />
                          <span className="font-bold text-sm">{audit.score}/5</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {new Date(audit.created_at).toLocaleDateString("en-CA")}
                        </span>
                      </div>
                      {audit.criteria && (
                        <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                          {Object.entries(audit.criteria).map(([key, val]) => (
                            <div key={key} className="flex justify-between bg-gray-50 rounded px-2 py-0.5">
                              <span className="capitalize text-gray-600">{key === "sop" ? "SOP" : key}</span>
                              <span className="font-medium">{val}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {audit.notes && (
                        <p className="text-xs text-gray-600">{audit.notes}</p>
                      )}
                      {audit.appealed_at && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Appealed: {audit.appeal_reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score History */}
            {scores.length > 1 && (
              <div className="bg-white rounded-xl shadow-elevation-1 p-5">
                <h2 className="font-semibold text-brand-ink text-sm mb-3">Score History</h2>
                <div className="space-y-2">
                  {scores.slice(1).map((s) => (
                    <div key={s.week_start} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-600">
                        {new Date(s.week_start).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{s.total_score}</span>
                        {getTrustBadge(s.trust_level)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
