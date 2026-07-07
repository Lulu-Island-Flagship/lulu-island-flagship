"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  MapPin,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

interface AdminService {
  orderId: string;
  serviceDate: string;
  serviceTime: string;
  orderStatus: string;
  assignmentStatus: string;
  employeeName: string;
  employeeEmail: string;
  address: string;
  zone: string;
  serviceType: string;
  serviceSubtype: string;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  total: number;
  completedItems: number;
  totalItems: number;
  percentComplete: number;
}

export default function AdminServiciosClient() {
  const [services, setServices] = useState<AdminService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadServices();
  }, []);

  async function loadServices() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/servicios", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load services");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-gray-100 text-gray-700",
      en_route: "bg-blue-100 text-blue-700",
      arrived: "bg-yellow-100 text-yellow-700",
      in_progress: "bg-purple-100 text-purple-700",
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-red-100 text-red-700",
      no_show: "bg-red-100 text-red-700",
    };
    return styles[status] || "bg-gray-100 text-gray-700";
  };

  const formatStatus = (status: string) =>
    status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">Today&apos;s Services</h1>
        <span className="text-sm text-gray-500">
          {services.length} service{services.length !== 1 ? "s" : ""}
        </span>
      </div>

      {services.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No services scheduled for today.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <div
              key={s.orderId}
              className="w-full bg-white rounded-xl border p-4 text-left hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getStatusBadge(s.assignmentStatus)}`}>
                      {formatStatus(s.assignmentStatus)}
                    </span>
                    <span className="text-xs text-gray-400">{s.serviceSubtype.replace(/_/g, " ")}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-brand-ink">
                    <Clock className="w-4 h-4 text-brand-gold" />
                    <span className="font-medium">{s.serviceTime}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{s.address}, {s.zone}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>{s.employeeName}</span>
                  </div>

                  {s.totalItems > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-brand-gold h-2 rounded-full transition-all"
                          style={{ width: `${s.percentComplete}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {s.percentComplete}% ({s.completedItems}/{s.totalItems})
                      </span>
                    </div>
                  )}
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300 mt-1" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
