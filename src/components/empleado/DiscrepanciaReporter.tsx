"use client";

import React, { useState } from "react";
import { Camera, AlertTriangle, Send, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface DiscrepanciaReporterProps {
  orderId: string;
  onReported?: () => void;
}

export function DiscrepanciaReporter({ orderId, onReported }: DiscrepanciaReporterProps) {
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/discrepancia/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("service-photos")
        .getPublicUrl(fileName);

      setPhotos((prev) => [...prev, publicUrlData.publicUrl]);
    } catch (e) {
      console.error("Photo upload error:", e);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!note.trim() && photos.length === 0) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/empleado/servicio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          eventType: "note",
          notes: `DISCREPANCIA: ${note.trim()}${photos.length > 0 ? ` | Fotos: ${photos.join(", ")}` : ""}`,
        }),
      });

      if (res.ok) {
        setNote("");
        setPhotos([]);
        onReported?.();
      }
    } catch (e) {
      console.error("Discrepancia submit error:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-center gap-2 text-amber-700">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">Report Condition Discrepancy</span>
        </div>
        <p className="text-xs text-amber-600 mt-1">
          Report if the actual condition differs from what was quoted. Include photos and a brief description.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          aria-label="Descripción de la discrepancia de condición"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe what you found differently..."
          rows={3}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none resize-none"
        />
      </div>

      {/* Photos */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Photos (required: 2 recommended)</label>
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`Discrepancy photo ${i + 1}`}
              className="w-20 h-20 rounded-lg object-cover"
            />
          ))}
          <label className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-brand-gold transition-colors">
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : (
              <Camera className="w-5 h-5 text-gray-400" />
            )}
            <input
              type="file"
              aria-label="Agregar foto de la discrepancia"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      <button
        aria-label="Reportar discrepancia"
        onClick={handleSubmit}
        disabled={(!note.trim() && photos.length === 0) || isSubmitting}
        className="w-full bg-amber-600 text-white py-2.5 rounded-lg font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Send className="w-4 h-4" />
            Report Discrepancy
          </>
        )}
      </button>
    </div>
  );
}
