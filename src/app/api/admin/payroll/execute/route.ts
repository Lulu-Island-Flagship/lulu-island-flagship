import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction, getServiceRoleClient } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import { executePayrollCycle, type PayrollCiclo } from "@/lib/payroll-engine";
import type { PayrollCalculationResult } from "@/lib/payroll-calculator";

// POST /api/admin/payroll/execute — cerrar un ciclo de nómina y generar
// el asiento contable (Journal Entry) en el Financial Ledger.
//
// Body: { ciclo_id: string }
//
// Pipeline:
//   1. Verifica que el caller tenga rol "payroll" (owner_admin únicamente).
//   2. Registra la acción en admin_action_logs.
//   3. Carga el ciclo desde payroll_ciclo y sus líneas desde payroll_linea.
//   4. Llama a executePayrollCycle() — state machine CALCULANDO → CERRADO.
//   5. Persiste el ciclo actualizado y el asiento contable en financial_ledger.
//
// El endpoint asume que las líneas de nómina YA fueron calculadas y persisten
// en payroll_linea con estado CALCULANDO. Si el ciclo no tiene líneas o no
// está en CALCULANDO, devuelve 400.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("payroll", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.status || 401 },
    );
  }
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const logResult = await logAdminAction({
      supabase: auth.supabase,
      user: auth.user,
      roles: auth.roles,
      resource: "payroll",
      method: request.method,
      path: request.url,
    });
    if (logResult.error) {
      return NextResponse.json(
        { error: logResult.error },
        { status: logResult.status },
      );
    }

    const { ciclo_id } = body as { ciclo_id?: string };
    if (!ciclo_id) {
      return NextResponse.json(
        { error: "Missing required field: ciclo_id" },
        { status: 400 },
      );
    }

    // ── Cargar ciclo ──────────────────────────────────────────────────
    const { data: cicloRow, error: cicloError } = await auth.supabase
      .from("payroll_ciclo")
      .select("*")
      .eq("ciclo_id", ciclo_id)
      .single();

    if (cicloError || !cicloRow) {
      if (cicloError) {
        console.error("payroll/execute: failed to load payroll cycle:", cicloError);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      return NextResponse.json({ error: "Payroll cycle not found" }, { status: 404 });
    }

    const ciclo = cicloRow as PayrollCiclo;
    if (ciclo.estado !== "CALCULANDO") {
      return NextResponse.json(
        {
          error: `Cycle must be in CALCULANDO state (current: ${ciclo.estado})`,
        },
        { status: 400 },
      );
    }

    // ── Cargar líneas de nómina ───────────────────────────────────────
    const { data: lineas, error: lineasError } = await auth.supabase
      .from("payroll_linea")
      .select("*")
      .eq("ciclo_id", ciclo_id);

    if (lineasError) {
      console.error("payroll/execute: failed to fetch payroll lines:", lineasError);
      return NextResponse.json({ error: "Failed to fetch payroll lines" }, { status: 500 });
    }

    if (!lineas || lineas.length === 0) {
      return NextResponse.json(
        { error: "Cycle has no payroll lines — calculate lines before executing" },
        { status: 400 },
      );
    }

    // ── Mapear payroll_linea → PayrollCalculationResult[] ─────────────
    const resultados: PayrollCalculationResult[] = lineas.map((linea: Record<string, unknown>) => {
      const l = linea as Record<string, number | string | null>;
      const total_deductions =
        (Number(l.cpp_empleado) || 0) +
        (Number(l.ei_empleado) || 0) +
        (Number(l.tax_federal) || 0) +
        (Number(l.tax_provincial) || 0);
      const total_employer =
        (Number(l.cpp_employer) || 0) +
        (Number(l.ei_employer) || 0) +
        (Number(l.worksafebc_prima) || 0);

      return {
        employee_id: String(l.employee_id || ""),
        ciclo_id: String(l.ciclo_id || ""),
        day_rate_cents: Number(l.day_rate_cents) || 0,
        comisiones_cents: Number(l.comisiones_cents) || 0,
        horas_extra_cents: Number(l.horas_extra_cents) || 0,
        vacation_pay_cents: Number(l.vacation_pay_cents) || 0,
        gross_cents: Number(l.gross_cents) || 0,
        cpp_employee_cents: Number(l.cpp_empleado) || 0,
        ei_employee_cents: Number(l.ei_empleado) || 0,
        tax_federal_cents: Number(l.tax_federal) || 0,
        tax_provincial_cents: Number(l.tax_provincial) || 0,
        total_deductions_cents: total_deductions,
        cpp_employer_cents: Number(l.cpp_employer) || 0,
        ei_employer_cents: Number(l.ei_employer) || 0,
        worksafebc_cents: Number(l.worksafebc_prima) || 0,
        total_employer_cents: total_employer,
        ytd_gross: Number(l.ytd_gross) || 0,
        ytd_cpp: Number(l.ytd_cpp) || 0,
        ytd_ei: Number(l.ytd_ei) || 0,
        ytd_tax: Number(l.ytd_tax) || 0,
        vacation_pay_rate: 0.04, // default 4%; override if needed
        neto_pagar_cents: Number(l.neto_pagar) || 0,
        years_of_service: 0,
      } satisfies PayrollCalculationResult;
    });

    // ── Ejecutar ciclo de nómina ─────────────────────────────────────
    const createdBy = auth.user.id;
    const { ciclo: cerrado, journalEntry } = executePayrollCycle(
      ciclo,
      resultados,
      createdBy,
    );

    // ── Persistir ciclo actualizado ───────────────────────────────────
    const { error: updateError } = await auth.supabase
      .from("payroll_ciclo")
      .update({
        estado: cerrado.estado,
        total_bruto: cerrado.total_bruto,
        total_deducciones: cerrado.total_deducciones,
        total_neto: cerrado.total_neto,
        total_employer_contributions: cerrado.total_employer_contributions,
        actualizado_en: cerrado.actualizado_en,
      })
      .eq("ciclo_id", cerrado.ciclo_id);

    if (updateError) {
      console.error("payroll/execute: failed to update cycle:", updateError);
      return NextResponse.json(
        { error: "Failed to update cycle" },
        { status: 500 },
      );
    }

    // ── Insertar asiento contable en financial_ledger ──────────────────
    // Fix (migración 368): financial_ledger solo acepta escrituras de
    // service_role. requireAdminRole ya validó el rol del caller; la escritura
    // se hace con el cliente de servicio (bypasea RLS a propósito).
    const serviceClient = getServiceRoleClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
    }
    const { error: ledgerError } = await serviceClient
      .from("financial_ledger")
      .insert(journalEntry);

    if (ledgerError) {
      console.error("payroll/execute: failed to insert journal entries:", ledgerError);
      return NextResponse.json({ error: "Failed to insert journal entries" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ciclo: cerrado,
        journalEntry,
        journalEntryCount: journalEntry.length,
      },
      { status: 200 },
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}
