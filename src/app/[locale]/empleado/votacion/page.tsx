"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Star,
  CheckCircle2,
  Users,
} from "lucide-react";

interface Peer {
  id: string;
  name: string;
  role: string;
  alreadyVoted: boolean;
  myRating: number | null;
}

export default function EmpleadoVotacionPage() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [votingFor, setVotingFor] = useState<string | null>(null);
  const [rating, setRating] = useState(3);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadPeers();
  }, []);

  async function loadPeers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/votacion", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load peers");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setPeers(data.peers || []);
      setWeekStart(data.weekStart || "");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitVote(targetEmployeeId: string) {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/empleado/votacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetEmployeeId, rating, note: note.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to submit vote");
        setSubmitting(false);
        return;
      }
      setSuccess("Vote submitted!");
      setVotingFor(null);
      setRating(3);
      setNote("");
      loadPeers();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const votedCount = peers.filter((p) => p.alreadyVoted).length;
  const totalPeers = peers.length;

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-gold" />
            <span className="font-semibold text-sm">Peer Voting</span>
          </div>
          <a
            href="/empleado"
            className="text-sm text-gray-300 hover:text-white transition-colors"
          >
            Back
          </a>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Progress */}
        <div className="bg-white rounded-xl shadow-elevation-1 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-brand-ink">Progress</span>
            <span className="text-sm text-gray-500">{votedCount}/{totalPeers} voted</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-brand-gold h-2 rounded-full transition-all"
              style={{ width: totalPeers > 0 ? `${(votedCount / totalPeers) * 100}%` : "0%" }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">Week of {weekStart || "—"}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        ) : (
          <>
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto mb-1" />
                <p className="text-green-700 font-medium">{success}</p>
              </div>
            )}

            <div className="space-y-3">
              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="bg-white rounded-xl shadow-elevation-1 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-brand-ink">{peer.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{peer.role}</p>
                    </div>
                    {peer.alreadyVoted ? (
                      <div className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">{peer.myRating}★</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setVotingFor(peer.id);
                          setRating(3);
                          setNote("");
                          setError("");
                        }}
                        className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
                      >
                        Vote
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Vote Modal */}
      {votingFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">
                Rate {peers.find((p) => p.id === votingFor)?.name}
              </h2>
              <button
                onClick={() => setVotingFor(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                    rating >= n
                      ? "bg-brand-gold text-white"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  <Star className="w-5 h-5 fill-current" />
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-gray-500">
              {rating === 1 && "Poor"}
              {rating === 2 && "Fair"}
              {rating === 3 && "Good"}
              {rating === 4 && "Very Good"}
              {rating === 5 && "Excellent"}
            </p>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (only visible to admin)..."
              className="w-full border rounded-lg p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={() => submitVote(votingFor)}
              disabled={submitting}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Vote"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
