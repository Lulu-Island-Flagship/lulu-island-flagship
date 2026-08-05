"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Users, AlertCircle } from "lucide-react";

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}

export default function AdminClientsPage() {
  const t = useTranslations("admin.clients");
  const params = useParams();
  const locale = (params?.locale as string) || "en";

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/clients/recent", {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error || t("errorLoadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setClients(data.clients || []);
    } catch {
      setError(t("errorLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
          <p className="text-sm text-gray-500">{t("subtitle")}</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 text-center">
          <p className="text-gray-500">{t("table.noClients")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-elevation-1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    {t("table.name")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    {t("table.email")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    {t("table.phone")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    {t("table.registered")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-brand-ink">
                      {client.name}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{client.email}</td>
                    <td className="px-4 py-3 text-gray-600">{client.phone}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(client.createdAt).toLocaleDateString(locale, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
