"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Camera, AlertTriangle, Send, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

interface DiscrepanciaReporterProps {
  orderId: string;
  onReported?: () => void;
}

export function DiscrepanciaReporter({ orderId, onReported }: DiscrepanciaReporterProps) {
  const tDis = useTranslations("employee");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Auditoría UX/seguridad 2026-07-25 (#6): antes los fallos de subida de
  // foto y de envío del reporte solo iban a console.error -- el empleado
  // veía la UI "quedarse igual" y podía creer que su reporte de
  // discrepancia se envió cuando en realidad nunca llegó al servidor.
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setUploading(true);
    setPhotoUploadError("");
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/discrepancia/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        setPhotoUploadError(tDis("discrepancyPhotoUploadFailed"));
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("service-photos")
        .getPublicUrl(fileName);

      setPhotos((prev) => [...prev, publicUrlData.publicUrl]);
    } catch (e) {
      console.error("Photo upload error:", e);
      setPhotoUploadError(tDis("discrepancyPhotoConnectionError"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!note.trim() && photos.length === 0) return;

    setIsSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/employee/service", {
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
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Discrepancia submit rejected:", err.error);
        setSubmitError(err.error || tDis("discrepancySubmitFailed"));
      }
    } catch (e) {
      console.error("Discrepancia submit error:", e);
      setSubmitError(tDis("discrepancySubmitConnectionError"));
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
        <label htmlFor="discrepancy-description" className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          id="discrepancy-description"
          aria-label={tDis("discrepancyDescriptionAria")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={tDis("discrepancyDescriptionPlaceholder")}
          rows={3}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none resize-none"
        />
      </div>

      {/* Photos */}
      <div>
        <p className="block text-xs font-medium text-gray-600 mb-2">Photos (required: 2 recommended)</p>
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <Image
              key={i}
              src={url}
              alt={`Discrepancy photo ${i + 1}`}
              width={80}
              height={80}
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
              aria-label={tDis("discrepancyAddPhotoAria")}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
              disabled={uploading}
            />
          </label>
        </div>
        <ErrorBanner message={photoUploadError} className="mt-2" />
      </div>

      <ErrorBanner message={submitError} onRetry={handleSubmit} retrying={isSubmitting} />

      <button
        aria-label={tDis("discrepancyReportAria")}
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
