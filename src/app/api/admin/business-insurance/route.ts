import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  computePolicyStatus,
  meetsRequiredCoverage,
  missingPolicyTypes,
  REQUIRED_POLICY_TYPES,
  type PolicyType,
} from "@/lib/business-insurance";

/**
 * GET/POST /api/admin/business-insurance — v8.3 E7 (D.9 punto 9). Solo
 * owner_admin (reusa el recurso "finance", ya restringido en admin-rbac.ts
 * -- misma sensibilidad que pricing_settings/payroll).
 *
 * IMPORTANTE (B.4): esto NUNCA habilita el claim público "asegurados/bonded"
 * -- eso sigue bloqueado hasta confirmación escrita del dueño, por
 * separado. Esta ruta solo registra y alerta.
 */
export async function GET() {
  const auth = await requireAdminRole("finance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: policies, error } = await auth.supabase
    .from("business_insurance_policies")
    .select("id, policy_type, provider, policy_number, coverage_amount_cents, effective_from, expiry_date, document_url, notes, is_active, created_at")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("policy_type", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (policies || []).map((p: { policy_type: string; expiry_date: string; coverage_amount_cents: number }) => ({
    ...p,
    status: computePolicyStatus({ expiryDate: p.expiry_date }),
    meetsRequiredCoverage: meetsRequiredCoverage({
      policyType: p.policy_type as PolicyType,
      coverageAmountCents: p.coverage_amount_cents,
    }),
  }));

  const missing = missingPolicyTypes((policies || []).map((p: { policy_type: string }) => p.policy_type));

  return NextResponse.json(
    {
      policies: enriched,
      missingPolicyTypes: missing,
      allThreePoliciesReady: missing.length === 0 && enriched.every((p) => p.status !== "expired" && p.meetsRequiredCoverage),
      requiredPolicyTypes: REQUIRED_POLICY_TYPES,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { policyType, provider, policyNumber, coverageAmountDollars, effectiveFrom, expiryDate, documentUrl, notes } = body;

    if (!REQUIRED_POLICY_TYPES.includes(policyType)) {
      return NextResponse.json(
        { error: `policyType must be one of: ${REQUIRED_POLICY_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!provider || typeof provider !== "string" || provider.trim().length === 0) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (typeof coverageAmountDollars !== "number" || coverageAmountDollars <= 0) {
      return NextResponse.json({ error: "coverageAmountDollars must be a positive number" }, { status: 400 });
    }
    if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      return NextResponse.json({ error: "effectiveFrom must be a YYYY-MM-DD date" }, { status: 400 });
    }
    if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      return NextResponse.json({ error: "expiryDate must be a YYYY-MM-DD date" }, { status: 400 });
    }
    if (expiryDate <= effectiveFrom) {
      return NextResponse.json({ error: "expiryDate must be after effectiveFrom" }, { status: 400 });
    }

    // Reemplaza la póliza activa anterior del mismo tipo (si hay) -- índice
    // único de la migración 139 solo permite una activa por tipo.
    const { data: previous } = await auth.supabase
      .from("business_insurance_policies")
      .select("id")
      .eq("policy_type", policyType)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (previous) {
      await auth.supabase
        .from("business_insurance_policies")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", previous.id);
    }

    const { data: policy, error } = await auth.supabase
      .from("business_insurance_policies")
      .insert({
        policy_type: policyType,
        provider: provider.trim(),
        policy_number: policyNumber ? String(policyNumber).trim() : null,
        coverage_amount_cents: Math.round(coverageAmountDollars * 100),
        effective_from: effectiveFrom,
        expiry_date: expiryDate,
        document_url: documentUrl ? String(documentUrl).trim() : null,
        notes: notes ? String(notes).trim() : null,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ policy }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
