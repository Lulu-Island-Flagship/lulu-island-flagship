"use client";

/**
 * v8.5 Day 8 — Panel de edición de contenido del landing page.
 * Permite editar TODOS los textos del landing y subir/eliminar imágenes
 * sin tocar código. Acceso: solo admin.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Check, AlertTriangle, Upload, Trash2 } from "lucide-react";
import { useAdminRoles } from "@/lib/useAdminRoles";

const CONTENT_KEYS: { key: string; label: string; multiline?: boolean }[] = [
  { key: "hero.title", label: "Hero — Title" },
  { key: "hero.subtitle", label: "Hero — Subtitle" },
  { key: "hero.proposition", label: "Hero — Proposition", multiline: true },
  { key: "hero.cta", label: "Hero — Button text" },
  { key: "hero.placeholder", label: "Hero — Address placeholder" },
  { key: "hero.hint", label: "Hero — Hint below button" },
  { key: "how.title", label: "How It Works — Section title" },
  { key: "how.step1", label: "How It Works — Step 1", multiline: true },
  { key: "how.step2", label: "How It Works — Step 2", multiline: true },
  { key: "how.step3", label: "How It Works — Step 3", multiline: true },
  { key: "how.step4", label: "How It Works — Step 4", multiline: true },
  { key: "standards.title", label: "Standards — Section title" },
  { key: "standards.1.title", label: "Standards 1 — Title" },
  { key: "standards.1.body", label: "Standards 1 — Body", multiline: true },
  { key: "standards.2.title", label: "Standards 2 — Title" },
  { key: "standards.2.body", label: "Standards 2 — Body", multiline: true },
  { key: "standards.3.title", label: "Standards 3 — Title" },
  { key: "standards.3.body", label: "Standards 3 — Body", multiline: true },
  { key: "standards.4.title", label: "Standards 4 — Title" },
  { key: "standards.4.body", label: "Standards 4 — Body", multiline: true },
  { key: "included.title", label: "Included — Title" },
  { key: "included.body", label: "Included — Body", multiline: true },
  { key: "not_included.title", label: "Not Included — Title" },
  { key: "not_included.body", label: "Not Included — Body", multiline: true },
  { key: "breaks.title", label: "If Something Breaks — Title" },
  { key: "breaks.body", label: "If Something Breaks — Body", multiline: true },
  { key: "faq.title", label: "FAQ — Section title" },
  { key: "faq.q1", label: "FAQ — Question 1" },
  { key: "faq.a1", label: "FAQ — Answer 1", multiline: true },
  { key: "faq.q2", label: "FAQ — Question 2" },
  { key: "faq.a2", label: "FAQ — Answer 2", multiline: true },
  { key: "faq.q3", label: "FAQ — Question 3" },
  { key: "faq.a3", label: "FAQ — Answer 3", multiline: true },
  { key: "faq.q4", label: "FAQ — Question 4" },
  { key: "faq.a4", label: "FAQ — Answer 4", multiline: true },
  { key: "faq.q5", label: "FAQ — Question 5" },
  { key: "faq.a5", label: "FAQ — Answer 5", multiline: true },
  { key: "footer.tagline", label: "Footer — Tagline" },
];

const IMAGE_SLOTS = [
  { key: "image.hero", label: "Hero background", hint: "1920×1080 px. Appears behind hero text with dark overlay." },
  { key: "image.divider1", label: "Section divider 1", hint: "1920×600 px. Between How It Works and Standards." },
  { key: "image.divider2", label: "Section divider 2", hint: "1920×600 px. Before FAQ section." },
];

export default function ContentAdminPage() {
  const { roles, loading: rolesLoading } = useAdminRoles();
  const isAdmin = roles.includes("owner_admin");

  // Text state
  const [content, setContent] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Image state
  const [images, setImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  // Fetch current content
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/admin/content")
      .then((res) => (res.ok ? res.json() : { content: [] }))
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of data.content ?? []) {
          map[row.key] = row.value;
        }
        // Split image keys from text keys
        const imgs: Record<string, string> = {};
        for (const slot of IMAGE_SLOTS) {
          if (map[slot.key]) {
            imgs[slot.key] = map[slot.key];
            delete map[slot.key];
          }
        }
        setContent(map);
        setImages(imgs);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Save text key
  const saveKey = useCallback(async (key: string) => {
    const value = dirty[key] ?? content[key] ?? "";
    setSaving((s) => ({ ...s, [key]: true }));
    const res = await fetch("/api/admin/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) {
      setContent((c) => ({ ...c, [key]: value }));
      setDirty((d) => { const n = { ...d }; delete n[key]; return n; });
      setSaved((s) => ({ ...s, [key]: true }));
      setTimeout(() => setSaved((s) => { const n = { ...s }; delete n[key]; return n; }), 2000);
    }
    setSaving((s) => { const n = { ...s }; delete n[key]; return n; });
  }, [dirty, content]);

  // Upload image
  const uploadImage = useCallback(async (slot: string, file: File) => {
    setUploading((u) => ({ ...u, [slot]: true }));
    const formData = new FormData();
    formData.append("slot", slot);
    formData.append("file", file);
    const res = await fetch("/api/admin/content/image", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      setImages((imgs) => ({ ...imgs, [slot]: data.url }));
    }
    setUploading((u) => { const n = { ...u }; delete n[slot]; return n; });
  }, []);

  // Remove image
  const removeImage = useCallback(async (slot: string) => {
    setUploading((u) => ({ ...u, [slot]: true }));
    await fetch("/api/admin/content/image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    setImages((imgs) => { const n = { ...imgs }; delete n[slot]; return n; });
    setUploading((u) => { const n = { ...u }; delete n[slot]; return n; });
  }, []);

  if (rolesLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-6 h-6 animate-spin text-brand-navy" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-state-warning mx-auto mb-4" />
          <p className="text-brand-ink text-lg font-semibold">Access denied</p>
          <p className="text-gray-500 text-sm mt-1">This page requires admin access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-bold text-brand-ink mb-2">Landing Page Content</h1>
        <p className="text-sm text-gray-500 mb-10">
          Edit the text and images that appear on the public landing page. Changes appear within 60 seconds.
        </p>

        {/* TEXT SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-brand-navy mb-6">Text</h2>
          <div className="space-y-5">
            {CONTENT_KEYS.map(({ key, label, multiline }) => {
              const value = dirty[key] !== undefined ? dirty[key] : (content[key] ?? "");
              const isSaving = saving[key];
              const isSaved = saved[key];

              return (
                <div key={key} className="border border-brand-ice rounded-md p-4">
                  <label htmlFor={key} className="block text-xs font-medium text-brand-navy uppercase tracking-wide mb-2">
                    {label}
                  </label>
                  {multiline ? (
                    <textarea
                      id={key}
                      value={value}
                      onChange={(e) => setDirty((d) => ({ ...d, [key]: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-brand-ice rounded-md text-sm text-brand-ink bg-white
                                 focus:outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
                    />
                  ) : (
                    <input
                      id={key}
                      type="text"
                      value={value}
                      onChange={(e) => setDirty((d) => ({ ...d, [key]: e.target.value }))}
                      className="w-full px-3 py-2 border border-brand-ice rounded-md text-sm text-brand-ink bg-white
                                 focus:outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
                    />
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => saveKey(key)}
                      disabled={isSaving || dirty[key] === undefined}
                      className="px-3 py-1.5 bg-brand-navy text-white text-xs rounded-md font-medium
                                 hover:bg-brand-navyLight transition-colors disabled:opacity-50"
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                    {isSaved && (
                      <span className="flex items-center gap-1 text-xs text-state-success">
                        <Check className="w-3 h-3" /> Saved
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* IMAGE SECTION */}
        <section>
          <h2 className="text-lg font-semibold text-brand-navy mb-6">Images</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {IMAGE_SLOTS.map(({ key, label, hint }) => {
              const url = images[key];
              const isUploading = uploading[key];

              return (
                <div key={key} className="border border-brand-ice rounded-md p-4">
                  <p className="text-xs font-medium text-brand-navy uppercase tracking-wide mb-1">{label}</p>
                  <p className="text-xs text-gray-400 mb-3">{hint}</p>
                  {url ? (
                    <div>
                      <div className="relative w-full h-32 mb-3 bg-brand-ice rounded overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={label} className="w-full h-full object-cover" />
                      </div>
                      <button
                        onClick={() => removeImage(key)}
                        disabled={isUploading}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-state-danger border border-state-danger rounded-md
                                   hover:bg-state-danger hover:text-white transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        {isUploading ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-brand-ice rounded-md
                                      cursor-pointer hover:border-brand-navy transition-colors">
                      {isUploading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-brand-navy" />
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-brand-wave-blue" />
                          <span className="text-xs text-brand-wave-blue">Upload image</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden" aria-label="Upload image"
                        disabled={isUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadImage(key, file);
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
