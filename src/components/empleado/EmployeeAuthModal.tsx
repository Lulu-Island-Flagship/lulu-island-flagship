"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Shield, Mail, Loader2, CheckCircle2 } from "lucide-react";

interface EmployeeAuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function EmployeeAuthModal({ onClose, onSuccess }: EmployeeAuthModalProps) {
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOtp = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }
    setIsLoading(true);
    setError("");

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });

      if (otpError) throw otpError;
      setOtpSent(true);
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Failed to send code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    setIsLoading(true);
    setError("");

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: "email",
      });

      if (verifyError) throw verifyError;
      onSuccess();
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-elevation-2 w-full max-w-sm p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-brand-navy/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-brand-navy" />
          </div>
          <h2 className="text-lg font-bold text-brand-ink">Employee Login</h2>
          <p className="text-sm text-gray-500 mt-1">
            {otpSent ? "Enter the code sent to your email" : "Sign in with your work email"}
          </p>
        </div>

        {!otpSent ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Work Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@luluislandflagship.ca"
                  className="w-full pl-10 pr-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSendOtp}
              disabled={isLoading}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                "Send Code"
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                6-Digit Code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full px-3 py-2.5 border rounded-lg text-sm text-center tracking-widest font-mono focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
              />
            </div>

            {error && (
              <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleVerifyOtp}
              disabled={isLoading}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Verify & Sign In
                </span>
              )}
            </button>

            <button
              onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); }}
              className="w-full text-sm text-gray-500 hover:text-brand-navy transition-colors"
            >
              Back to email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
