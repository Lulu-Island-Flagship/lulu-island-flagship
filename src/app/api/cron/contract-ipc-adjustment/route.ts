import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVancouverTodayString } from "@/lib/date-utils";
import { calculateMinimumWageImpact } from "@/lib/economic-params";
import {
  isIpcNoticeDue,
  isIpcAdjustmentDue,
  calculateIpcAdjustedContractPrice,
} from "@/lib/contract-ipc-adjustment";

/**
 * POST /api/cron/contract-ipc-adjustment
 *
 * Job programado para ejecutarse todos los días a las 8:00 AM hora
 * Vancouver (v8.3 E2.8 / D.9 Doc 2): "cronjob de ajuste IPC al aniversario
 * con aviso 30 días".
 *
 * Mismo patrón que el ajuste anual de salario mínimo BC: el % de IPC se
 * deriva de las dos filas más recientes de payroll_settings
 * (bc_min_wage_hourly), reusando calculateMinimumWageImpact (ver
 * src/lib/economic-params.ts) como fuente única del delta porcentual —
 * no se inventa un índice IPC nuevo ni separado.
 *
 * Para cada contrato activo:
 *  - Si hoy es 30 días antes del aniversario del año en curso → registra
 *    el aviso (contract_ipc_notices) con el precio proyectado.
 *  - Si hoy ES el aniversario → aplica el ajuste, snapshot inmutable en
 *    contract_ipc_adjustments, actualiza base_price/total del contrato.
 *
 * Vercel Cron corre en UTC, por eso se invoca 2 veces (3 PM y 4 PM UTC)
 * y dentro se verifica que en Vancouver sea exactamente las 8:00 AM.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const JOB_NAME = "contract_ipc_adjustment";

function vancouverHour(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? -1);
}

interface ServiceContractRow {
  id: string;
  start_date: string;
  base_price: number;
  total: number;
  status: string;
  last_ipc_notice_year: number | null;
  last_ipc_adjustment_year: number | null;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (vancouverHour() !== 8) {
    return NextResponse.json({ skipped: true, reason: "Not 8 AM Vancouver" }, { status: 200 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const todayStr = getVancouverTodayString();
  const currentYear = new Date(todayStr).getUTCFullYear();

  const { data: alreadyRan } = await supabase
    .from("cron_execution_guard")
    .select("job_name")
    .eq("job_name", JOB_NAME)
    .eq("run_date", todayStr)
    .maybeSingle();

  if (alreadyRan) {
    return NextResponse.json(
      { skipped: true, reason: "Contract IPC adjustment already ran today", date: todayStr },
      { status: 200 }
    );
  }

  const { data: ipcFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "recurring_contract_ipc_enabled")
    .single();

  if (!ipcFlag?.activo) {
    await supabase.from("cron_execution_guard").insert({ job_name: JOB_NAME, run_date: todayStr });
    return NextResponse.json(
      { skipped: true, reason: "recurring_contract_ipc_enabled flag is off — decisión pendiente del dueño" },
      { status: 200 }
    );
  }

  try {
    // % IPC: mismas dos filas más recientes de payroll_settings que
    // gobiernan el ajuste anual del salario mínimo BC (mismo patrón,
    // no un índice nuevo).
    const { data: wageHistory } = await supabase
      .from("payroll_settings")
      .select("bc_min_wage_hourly, effective_from")
      .order("effective_from", { ascending: false })
      .limit(2);

    if (!wageHistory || wageHistory.length < 2) {
      return NextResponse.json(
        { skipped: true, reason: "Not enough payroll_settings history to derive IPC %" },
        { status: 200 }
      );
    }

    const [latest, previous] = wageHistory;
    const wageImpact = calculateMinimumWageImpact({
      currentMinimumWage: Number(previous.bc_min_wage_hourly),
      newMinimumWage: Number(latest.bc_min_wage_hourly),
      currentMinimumDayRate: 0,
      standardDayHours: 8,
    });
    const ipcPercentage = wageImpact.deltaPercent;

    const { data: contracts, error } = await supabase
      .from("service_contracts")
      .select(
        "id, start_date, base_price, total, status, last_ipc_notice_year, last_ipc_adjustment_year"
      )
      .eq("status", "active");

    if (error) {
      console.error("Contract IPC adjustment fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = {
      noticesSent: 0,
      adjustmentsApplied: 0,
      errors: [] as { contractId: string; error: string }[],
    };

    for (const contract of (contracts as unknown as ServiceContractRow[]) || []) {
      try {
        // Aviso de 30 días (una vez por año/contrato — guard por last_ipc_notice_year)
        if (
          contract.last_ipc_notice_year !== currentYear &&
          isIpcNoticeDue(contract.start_date, todayStr, currentYear)
        ) {
          const projected = calculateIpcAdjustedContractPrice({
            currentBasePrice: contract.base_price,
            currentTotal: contract.total,
            ipcPercentage,
          });
          const anniversary = getAnniversaryIso(contract.start_date, currentYear);

          await supabase.from("contract_ipc_notices").insert({
            contract_id: contract.id,
            adjustment_year: currentYear,
            ipc_percentage: ipcPercentage,
            projected_new_base_price: projected.newBasePrice,
            projected_new_total: projected.newTotal,
            anniversary_date: anniversary,
          });

          await supabase
            .from("service_contracts")
            .update({ last_ipc_notice_sent_at: new Date().toISOString(), last_ipc_notice_year: currentYear })
            .eq("id", contract.id);

          results.noticesSent++;
        }

        // Ajuste real al aniversario (una vez por año/contrato — guard por last_ipc_adjustment_year)
        if (
          contract.last_ipc_adjustment_year !== currentYear &&
          isIpcAdjustmentDue(contract.start_date, todayStr, currentYear)
        ) {
          const adjusted = calculateIpcAdjustedContractPrice({
            currentBasePrice: contract.base_price,
            currentTotal: contract.total,
            ipcPercentage,
          });

          await supabase.from("contract_ipc_adjustments").insert({
            contract_id: contract.id,
            adjustment_year: currentYear,
            ipc_percentage: ipcPercentage,
            previous_base_price: contract.base_price,
            previous_total: contract.total,
            new_base_price: adjusted.newBasePrice,
            new_total: adjusted.newTotal,
          });

          await supabase
            .from("service_contracts")
            .update({
              base_price: adjusted.newBasePrice,
              total: adjusted.newTotal,
              last_ipc_adjustment_at: new Date().toISOString(),
              last_ipc_adjustment_year: currentYear,
              updated_at: new Date().toISOString(),
            })
            .eq("id", contract.id);

          results.adjustmentsApplied++;
        }
      } catch (err: Error | unknown) {
        const message = err instanceof Error ? err.message : "Unknown IPC adjustment error";
        results.errors.push({ contractId: contract.id, error: message });
        console.error(`Contract IPC adjustment failed for contract ${contract.id}:`, err);
      }
    }

    await supabase.from("cron_execution_guard").insert({ job_name: JOB_NAME, run_date: todayStr });

    return NextResponse.json(
      {
        success: true,
        date: todayStr,
        ipcPercentage,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Contract IPC adjustment job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getAnniversaryIso(startDateIso: string, year: number): string {
  const [, month, day] = startDateIso.split("-");
  return `${year}-${month}-${day}`;
}
