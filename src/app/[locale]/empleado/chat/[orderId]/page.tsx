"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2, Send, MessageCircle } from "lucide-react";

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
}

const MAX_LENGTH = 160;

/**
 * v8.3 E8.12 — Chat interno del equipo del día. Solo texto, 160 caracteres,
 * historial 7 días, activo solo en jornada.
 */
export default function TeamChatPage() {
  const params = useParams();
  const orderId = params?.orderId as string;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function load() {
    try {
      const res = await fetch(`/api/empleado/team-chat?orderId=${orderId}`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setMessages(d.messages || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/team-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId, body: draft.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "No se pudo enviar");
        return;
      }
      setDraft("");
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setSending(false);
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
    <div className="flex flex-col h-[70vh] max-w-md mx-auto">
      <div className="mb-3">
        <h1 className="text-lg font-bold text-brand-ink flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-brand-wave-blue" /> Chat del equipo
        </h1>
        <p className="text-xs text-gray-500">Solo texto, historial de 7 días. Se cierra al terminar la jornada.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700 mb-2">{error}</div>}

      <div className="flex-1 overflow-y-auto space-y-2 bg-white rounded-xl border p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Aún no hay mensajes.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-medium text-brand-ink">{m.senderName}: </span>
              <span className="text-gray-700">{m.body}</span>
              <span className="text-xs text-gray-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString("en-CA", { timeZone: "America/Vancouver", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe un mensaje..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="bg-brand-navy text-white p-2.5 rounded-lg disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-400 text-right mt-1">{draft.length}/{MAX_LENGTH}</p>
    </div>
  );
}
