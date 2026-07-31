"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Send, MessageCircle, AlertTriangle } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
}

/**
 * v8.3 ROUND 4 fix (#5): mensajes que fallaban por un error de red (no un
 * rechazo del servidor) se perdían por completo -- no había cola de
 * reintento. Patrón mínimo (localStorage + reintento en 'online'), análogo
 * en espíritu a la cola offline de fotos/eventos de servicio
 * (offline-queue.ts) pero sin requerir IndexedDB para algo tan simple como
 * texto corto.
 */
interface PendingChatMessage {
  localId: string;
  orderId: string;
  body: string;
  capturedAtIso: string;
}

function pendingQueueKey(orderId: string) {
  return `lulu_chat_pending_${orderId}`;
}

function loadPendingQueue(orderId: string): PendingChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pendingQueueKey(orderId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingQueue(orderId: string, queue: PendingChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pendingQueueKey(orderId), JSON.stringify(queue));
  } catch {
    // localStorage lleno/deshabilitado -- best-effort, no debe romper el envío.
  }
}

const MAX_LENGTH = 160;

/**
 * v8.3 E8.12 — Chat interno del equipo del día. Solo texto, 160 caracteres,
 * historial 7 días, activo solo en jornada.
 */
export default function TeamChatPage() {
  const params = useParams();
  const orderId = params?.orderId as string;
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/empleado`;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const retryPending = useCallback(async () => {
    if (!orderId) return;
    const queue = loadPendingQueue(orderId);
    if (queue.length === 0) {
      setPendingCount(0);
      return;
    }
    const stillPending: PendingChatMessage[] = [];
    for (const item of queue) {
      try {
        const res = await fetch("/api/empleado/team-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId: item.orderId, body: item.body }),
        });
        if (!res.ok) {
          // Rechazo explícito del servidor: no reintentar indefinidamente el
          // mismo mensaje inválido, se descarta (igual que el patrón de
          // servicio en submitServiceEventOrQueue).
          continue;
        }
      } catch {
        stillPending.push(item);
      }
    }
    savePendingQueue(orderId, stillPending);
    setPendingCount(stillPending.length);
    if (stillPending.length < queue.length) {
      await load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    load();
    setPendingCount(loadPendingQueue(orderId).length);
    void retryPending();
    const interval = setInterval(load, 15000);
    window.addEventListener("online", retryPending);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", retryPending);
    };
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
    const body = draft.trim();
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/team-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId, body }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "No se pudo enviar");
        return;
      }
      setDraft("");
      await load();
    } catch {
      // Fallo de red real (no rechazo del servidor): encolar en vez de
      // perder el mensaje -- se reintenta solo con 'online'.
      const queue = loadPendingQueue(orderId);
      queue.push({
        localId: `${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        orderId,
        body,
        capturedAtIso: new Date().toISOString(),
      });
      savePendingQueue(orderId, queue);
      setPendingCount(queue.length);
      setDraft("");
      setError("No connection -- your message will send automatically when you're back online.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-ice">
        <EmpleadoBackHeader title="Chat del equipo" backHref={backHref} icon={MessageCircle} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title="Chat del equipo" backHref={backHref} icon={MessageCircle} />
      <div className="flex flex-col h-[70vh] max-w-md mx-auto px-4 py-4">
      <div className="mb-3">
        <p className="text-xs text-gray-500">Solo texto, historial de 7 días. Se cierra al terminar la jornada.</p>
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {pendingCount} message{pendingCount === 1 ? "" : "s"} waiting to send -- will retry automatically when you're online.
        </div>
      )}

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
          aria-label="Escribir mensaje de chat"
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe un mensaje..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button
          aria-label="Enviar mensaje"
          onClick={send}
          disabled={sending || !draft.trim()}
          className="bg-brand-navy text-white p-2.5 rounded-lg disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-gray-400 text-right mt-1">{draft.length}/{MAX_LENGTH}</p>
      </div>
    </div>
  );
}
