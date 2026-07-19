"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Users, Plus } from "lucide-react";

interface Team {
  id: string;
  name: string;
  avatar_initials: string | null;
  avatar_color: string | null;
  active: boolean;
  created_at: string;
}

/**
 * v8.3 E8 FIX-6 — CRUD de equipos. La tabla `teams` (migración 099) y su
 * ranking Top-3 semanal ya existían y ya tenían pantalla propia
 * (admin/team-ranking o similar), pero no había ninguna forma de CREAR o
 * editar un equipo desde el admin -- solo se podía insertar a mano en la
 * base de datos. Vista intencionalmente simple: nombre + iniciales/color de
 * avatar + activo/inactivo, nada de fotos ni datos individuales (mismo
 * principio de identidad mínima de la migración 099).
 */
export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0F2A4A");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/teams?include_inactive=true", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setTeams(data.teams || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function createTeam() {
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), avatarColor: color }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to create team");
        return;
      }
      setName("");
      load();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(team: Team) {
    try {
      const res = await fetch("/api/admin/teams", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: team.id, active: !team.active }),
      });
      if (res.ok) load();
    } catch {
      // no-op, la lista simplemente no se actualiza
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Users className="w-5 h-5" /> Teams
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Identidad mínima de equipo (nombre + iniciales/color). Sin fotos, sin datos individuales -- alimenta el
          ranking semanal Top-3.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-4 flex flex-col sm:flex-row gap-2">
        <input
          aria-label="Nombre del equipo nuevo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del equipo"
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <input
          aria-label="Color del avatar del equipo"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-12 h-10 border rounded-lg"
        />
        <button
          onClick={createTeam}
          aria-label="Crear equipo nuevo"
          disabled={creating || !name.trim()}
          className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Plus className="w-4 h-4" /> {creating ? "Creando..." : "Crear equipo"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : teams.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">No teams yet.</div>
      ) : (
        <div className="space-y-2">
          {teams.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: t.avatar_color || "#94a3b8" }}
                >
                  {t.avatar_initials}
                </span>
                <span className="text-sm font-medium text-brand-ink">{t.name}</span>
              </div>
              <button
                onClick={() => toggleActive(t)}
                className={`text-xs font-medium px-2 py-1 rounded-full ${
                  t.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {t.active ? "Active" : "Inactive"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
