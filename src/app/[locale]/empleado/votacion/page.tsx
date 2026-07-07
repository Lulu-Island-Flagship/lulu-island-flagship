"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Star,
  User,
  Loader2,
  Send,
  CheckCircle2,
} from "lucide-react";

interface Peer {
  id: string;
  name: string;
  role: string;
  alreadyVoted: boolean;
  myRating: number | null;
}

export default function EmpleadoVotacionPage() {
  const router = useRouter();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [loading, setLoading] = useState(true);
  const [votingFor, setVotingFor] = useState<string | null>(null);
  const [rating, setRating] = useState(4);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    loadPeers();
  }, []);

  async function loadPeers() {
    setLoading(true);
    try {
      const res = await fetch("/api/empleado/votacion", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/empleado");
        }
        return;
      }
      const data = await res.json();
      setPeers(data.peers || []);
      setWeekStart(data.weekStart || "");
    } catch (e) {
      console.error("Load peers error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function submitVote() {
    if (!votingFor) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/empleado/votacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetEmployeeId: votingFor, rating, note }),
      });

      if (res.ok) {
        setSubmitted(true);
        setVotingFor(null);
        setRating(4);
        setNote("");
        await loadPeers();
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch (e) {
      console.error("Submit vote error:", e);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push("/empleado")} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-brand-gold" />
            <h1 className="font-semibold">Peer Vote</h1>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {submitted && (
          <div className="mb-4 bg-state-success/10 text-state-success rounded-lg p-3 text-sm text-center flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Vote submitted successfully!
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">
          Week of {weekStart ? new Date(weekStart).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "..."}
          <br />
          Rate your peers. Votes are anonymous between peers — only admin sees the aggregate.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <div className="space-y-3">
            {peers.length === 0 ? (
              <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No peers to vote for.</p>
              </div>
            ) : (
              peers.map((peer) => (
                <div key={peer.id} className="bg-white rounded-xl shadow-elevation-1 p-4">
                  {votingFor === peer.id ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-brand-ink">Rate {peer.name}</span>
                        <button
                          onClick={() => { setVotingFor(null); setRating(4); setNote(""); }}
                          className="text-xs text-gray-500 hover:text-brand-ink"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="flex gap-2 justify-center">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            onClick={() => setRating(s)}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                              rating >= s ? "bg-brand-gold text-white" : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            <Star className="w-5 h-5" />
                          </button>
                        ))}
                      </div>

                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                        rows={2}
                        placeholder="Optional note (admin only)..."
                      />

                      <button
                        onClick={submitVote}
                        disabled={isSubmitting}
                        className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
                        Submit Vote
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-brand-ink text-sm">{peer.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{peer.role}</p>
                        {peer.alreadyVoted && peer.myRating && (
                          <div className="flex items-center gap-1 text-brand-gold text-xs mt-1">
                            <Star className="w-3 h-3 fill-current" />
                            <span>You rated {peer.myRating}/5</span>
                          </div>
                        )}
                      </div>
                      {peer.alreadyVoted ? (
                        <span className="text-xs text-state-success font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Voted
                        </span>
                      ) : (
                        <button
                          onClick={() => setVotingFor(peer.id)}
                          className="bg-brand-navy text-white text-sm px-3 py-1.5 rounded-lg hover:bg-brand-navy-light transition-colors"
                        >
                          Vote
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
