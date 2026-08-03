"use client";

import React, { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, User, Mail, Phone, Globe, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ProfileData {
  fullName: string | null;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  servicesCount: number;
}

export default function PerfilClient() {
  const t = useTranslations("cuenta.perfil");
  const tCommon = useTranslations("cuenta.common");
  const locale = useLocale();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [profileRes, clientRes] = await Promise.all([
        fetch("/api/client/profile", { credentials: "include" }),
        supabase.from("client_profiles").select("phone_verified, services_count").eq("user_id", user.id).maybeSingle(),
      ]);

      const profileData = profileRes.ok ? await profileRes.json() : {};

      setProfile({
        fullName: profileData.fullName ?? null,
        avatarUrl: profileData.avatarUrl ?? null,
        email: user.email ?? null,
        phone: user.phone ?? null,
        phoneVerified: clientRes.data?.phone_verified ?? false,
        servicesCount: clientRes.data?.services_count ?? 0,
      });
    } catch {
      setError(tCommon("networkErrorRetry"));
    } finally {
      setLoading(false);
    }
  }

  async function saveName() {
    setSavingName(true);
    setError("");
    try {
      const res = await fetch("/api/client/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fullName: nameValue.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      setNameSaved(true);
      setEditingName(false);
      setProfile((p) => p ? { ...p, fullName: nameValue.trim() } : p);
      setTimeout(() => setNameSaved(false), 3000);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSavingName(false);
    }
  }

  function startEditName() {
    setNameValue(profile?.fullName ?? "");
    setEditingName(true);
  }

  // ── Loading ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-brand-ink/50">
        {tCommon("loadFailedRetry")}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <h1 className="text-xl font-semibold text-brand-ink">{t("title")}</h1>

      {/* Error / Success */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {nameSaved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{t("savedSuccess")}</span>
        </div>
      )}

      {/* Avatar + Name */}
      <div className="bg-white rounded-2xl border border-brand-ice shadow-sm p-5">
        <div className="flex items-center gap-4">
          {profile.avatarUrl ? (
            !avatarError ? (
              <img
                src={profile.avatarUrl}
                alt=""
                className="w-14 h-14 rounded-full border-2 border-brand-ice"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-brand-ice flex items-center justify-center">
                <User className="w-6 h-6 text-brand-navy/40" />
              </div>
            )
          ) : (
            <div className="w-14 h-14 rounded-full bg-brand-ice flex items-center justify-center">
              <User className="w-6 h-6 text-brand-navy/40" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  maxLength={120}
                  className="flex-1 px-3 py-2 border border-brand-ice rounded-lg text-sm"
                  placeholder={t("namePlaceholder")}
                />
                <button
                  onClick={saveName}
                  disabled={savingName || !nameValue.trim()}
                  className="px-3 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : t("save")}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  disabled={savingName}
                  className="px-3 py-2 border border-brand-ice rounded-lg text-sm"
                >
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-lg font-semibold text-brand-ink">
                  {profile.fullName || t("noName")}
                </p>
                <button
                  onClick={startEditName}
                  className="text-xs text-brand-navy/60 hover:text-brand-navy mt-0.5"
                >
                  {t("editLabel")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white rounded-2xl border border-brand-ice shadow-sm divide-y divide-brand-ice/50">
        {/* Email */}
        <div className="flex items-center gap-3 px-5 py-4">
          <Mail className="w-5 h-5 text-brand-ink/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-ink/50">{t("emailLabel")}</p>
            <p className="text-sm text-brand-ink truncate">{profile.email || "—"}</p>
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-3 px-5 py-4">
          <Phone className="w-5 h-5 text-brand-ink/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-ink/50">{t("phoneLabel")}</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-brand-ink">{profile.phone || "—"}</p>
              {profile.phoneVerified ? (
                <span className="text-xs text-green-600 flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3" /> {t("verified")}
                </span>
              ) : profile.phone ? (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  {t("notVerified")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center gap-3 px-5 py-4">
          <Globe className="w-5 h-5 text-brand-ink/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-ink/50">{t("languageLabel")}</p>
            <p className="text-sm text-brand-ink">
              {locale === "en" ? "English" : locale === "zh" ? "中文" : "Français"}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 px-5 py-4">
          <CheckCircle2 className="w-5 h-5 text-brand-ink/40 shrink-0" />
          <div>
            <p className="text-xs text-brand-ink/50">{t("servicesLabel")}</p>
            <p className="text-sm text-brand-ink">{profile.servicesCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
