import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateSampledRejectionRate, decideGamingConsequence } from "@/lib/anti-gaming";
import { calculatePayroll, DEFAULT_SERVICE_MINUTES } from "@/lib/payroll";

// POST /api/admin/qc/[orderId]/review — aprobar o rechazar servicio
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { orderId } = await params;
    const body = await request.json();
    const { status, note, confirmReopenPaidOrder } = body;

    if (!status || !note) {
      return NextResponse.json({ error: "Status and note are required" }, { status: 400 });
    }

    // v8.3 E5 (auditoría 2026-07-18, migración 190) — 'rework': el admin
    // encontró un defecto menor y corregible, y le da al empleado 30 min
    // para resubmitir en vez de rechazar directamente o aprobar algo
    // incompleto.
    if (!["approved", "rejected", "rework"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: reviewer } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!reviewer?.id) {
      return NextResponse.json({ error: "Reviewer not found in employees table" }, { status: 403 });
    }

    // Leer ANTES de actualizar: necesitamos saber si esta review venía del
    // muestreo 10% sobre auto-aprobados (sampling_reason ==
    // 'elite_auto_approval_sample') para evaluar manipulación después, y
    // (v8.3 E2, auditoría 2026-07-18) los minutos de rework ya acumulados
    // en esta orden para la validación de piso salarial de abajo.
    const { data: existingReview } = await supabase
      .from("qc_reviews")
      .select("status, employee_id, sampling_reason, rework_minutes")
      .eq("order_id", orderId)
      .single();

    // v8.3 fix (migración N/A -- solo API, auditoría 2026-07-21, A-8): esta
    // ruta no validaba el estado previo antes de mutar una review terminal.
    // Una review ya 'approved' de una orden ya COBRADA (capture_captured_at
    // no nulo) podía volverse 'rejected'/'rework' días después sin ningún
    // aviso ni confirmación explícita -- a diferencia de
    // /api/empleado/qc-resubmit, que sí valida estado previo. Se bloquea
    // con 409 salvo que el body incluya confirmReopenPaidOrder:true.
    if (existingReview?.status === "approved") {
      const { data: orderForReopenCheck } = await supabase
        .from("orders")
        .select("capture_captured_at")
        .eq("id", orderId)
        .maybeSingle();

      if (orderForReopenCheck?.capture_captured_at && confirmReopenPaidOrder !== true) {
        return NextResponse.json(
          {
            error:
              "Esta QC review ya está 'approved' y la orden ya fue COBRADA " +
              `(capture_captured_at: ${orderForReopenCheck.capture_captured_at}). ` +
              "Cambiar su estado ahora reabre una revisión terminal sobre dinero ya capturado: " +
              "puede disparar rework/rechazo retroactivo, ajustes de nómina del empleado y " +
              "posibles reembolsos que ningún cron reconcilia automáticamente (ver B-P2-2 en el " +
              "informe de auditoría). Si de verdad quieres reabrirla, reenvía la petición con " +
              "{ confirmReopenPaidOrder: true } en el body.",
            requiresConfirmation: true,
            confirmField: "confirmReopenPaidOrder",
          },
          { status: 409 }
        );
      }
    }

    const nowForUpdate = new Date();
    const isRework = status === "rework";
    let acceptedReworkWindowMinutes = 30; // se ajusta abajo con employees.max_rework_minutes

    // v8.3 E2 (migración 186, auditoría 2026-07-18) — BLOQUEO PREVIO de
    // rework que rompe el mínimo legal de BC ($18.25/h). Bug crítico
    // encontrado: calculatePayroll() (src/lib/payroll.ts) siempre "tapaba"
    // el hueco compensando hasta el mínimo legal de forma silenciosa,
    // pagándose de más sin que nadie lo autorizara, en vez de bloquear el
    // rework y forzar una decisión humana ANTES de comprometer esos
    // minutos. Aquí, antes de aceptar 'rework', calculamos si el rework
    // (acumulado + esta ventana de hasta max_rework_minutes) haría caer la
    // tarifa efectiva por hora por debajo del mínimo legal -- si es así,
    // rechazamos la transición con 422 y exigimos escalación a supervisor
    // en vez de dejar que payroll lo subsidie después sin que nadie se
    // entere. También se hace cumplir aquí el tope de max_rework_minutes
    // (default 30) por si el acumulado ya lo superó en un ciclo anterior.
    if (isRework && existingReview?.employee_id) {
      const { data: wageEmployee } = await supabase
        .from("employees")
        .select("day_rate, max_rework_minutes, min_wage_floor_enabled")
        .eq("id", existingReview.employee_id)
        .single();

      const maxReworkMinutes = wageEmployee?.max_rework_minutes ?? 30;
      acceptedReworkWindowMinutes = maxReworkMinutes;
      const priorReworkMinutes = existingReview.rework_minutes ?? 0;
      // Ventana completa de este ciclo de rework: hasta max_rework_minutes
      // (30 min por defecto) es lo que el empleado tiene para corregir;
      // se evalúa el escenario de que use el máximo permitido, ya que es
      // el costo salarial que este 'rework' puede llegar a comprometer.
      const totalReworkMinutesIfUsed = priorReworkMinutes + maxReworkMinutes;

      // Tope de 30 min (o el configurado por empleado) SIEMPRE se hace
      // cumplir, sin importar el flag min_wage_floor_enabled -- es una
      // regla operativa distinta al piso salarial.
      if (priorReworkMinutes >= maxReworkMinutes) {
        return NextResponse.json(
          {
            error:
              `Este servicio ya acumuló ${priorReworkMinutes} min de rework, ` +
              `igualando o superando el tope legal de ${maxReworkMinutes} min. ` +
              `Requiere escalación a supervisor -- no se puede enviar a rework de nuevo automáticamente.`,
            escalationRequired: true,
            priorReworkMinutes,
            maxReworkMinutes,
          },
          { status: 422 }
        );
      }

      if (wageEmployee?.min_wage_floor_enabled !== false) {
        if (wageEmployee?.day_rate != null) {
          const payrollCheck = calculatePayroll({
            dayRate: wageEmployee.day_rate,
            estimatedServiceMinutes: DEFAULT_SERVICE_MINUTES,
            reworkMinutes: totalReworkMinutesIfUsed,
            maxReworkMinutes,
          });

          if (payrollCheck.minimumWageAdjustment > 0) {
            // Registrar el intento bloqueado para que quede rastro de la
            // escalación pendiente (no se persiste el rework, solo la
            // señal de que hizo falta escalar).
            await supabase
              .from("qc_reviews")
              .update({
                rework_escalated_at: nowForUpdate.toISOString(),
                rework_escalation_reason:
                  `Rework bloqueado: tarifa efectiva caería a $${(
                    (payrollCheck.grossAmount - payrollCheck.minimumWageAdjustment) /
                    100 /
                    (DEFAULT_SERVICE_MINUTES / 60)
                  ).toFixed(2)}/h antes del ajuste de mínimo legal, por debajo de $18.25/h.`,
              })
              .eq("order_id", orderId);

            return NextResponse.json(
              {
                error:
                  "Este rework llevaría la tarifa efectiva del empleado por debajo del mínimo legal de BC ($18.25/h). " +
                  "Se requiere escalación a supervisor para aprobar compensación adicional antes de continuar con el rework.",
                escalationRequired: true,
                priorReworkMinutes,
                proposedTotalReworkMinutes: totalReworkMinutesIfUsed,
                maxReworkMinutes,
              },
              { status: 422 }
            );
          }
        }
      }
    }

    const { data, error } = await supabase
      .from("qc_reviews")
      .update({
        status,
        note,
        reviewer_id: reviewer.id,
        reviewed_at: nowForUpdate.toISOString(),
        // v8.3 E5 (migración 190): timer de 30 min. Se limpian los campos de
        // rework anteriores si esta revisión NO es 'rework' (ej. tras
        // resubmisión el admin aprueba/rechaza directamente).
        rework_started_at: isRework ? nowForUpdate.toISOString() : null,
        rework_deadline: isRework
          ? new Date(nowForUpdate.getTime() + 30 * 60 * 1000).toISOString()
          : null,
        rework_note: isRework ? note : null,
        rework_resubmitted_at: null,
        rework_expired_at: null,
        // v8.3 E2 (migración 186): acumular minutos de rework aceptados
        // para que la próxima revisión pueda evaluar el tope/piso salarial
        // sobre el total real, no solo esta ventana.
        ...(isRework
          ? { rework_minutes: (existingReview?.rework_minutes ?? 0) + acceptedReworkWindowMinutes }
          : {}),
      })
      .eq("order_id", orderId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let gamingDetection: Record<string, unknown> | null = null;

    // v8.3 E5.2 — solo evaluamos manipulación cuando se RECHAZA un servicio
    // que había caído en la muestra del 10% (habría sido auto-aprobado de
    // no ser por el muestreo). Aprobar una muestra, o rechazar un servicio
    // normal (no muestreado), no es evidencia de nada.
    if (status === "rejected" && existingReview?.sampling_reason === "elite_auto_approval_sample" && existingReview.employee_id) {
      const employeeId = existingReview.employee_id as string;

      const { data: sampledReviews } = await supabase
        .from("qc_reviews")
        .select("status")
        .eq("employee_id", employeeId)
        .eq("sampling_reason", "elite_auto_approval_sample")
        .in("status", ["approved", "rejected"]);

      const evaluation = evaluateSampledRejectionRate(
        (sampledReviews || []).map((r) => ({ status: r.status as "approved" | "rejected" }))
      );

      if (evaluation.exceedsThreshold) {
        const { count: priorDetections } = await supabase
          .from("gaming_detections")
          .select("id", { count: "exact", head: true })
          .eq("employee_id", employeeId)
          .is("deleted_at", null);

        const consequence = decideGamingConsequence(priorDetections || 0);
        const nowIso = new Date().toISOString();
        let retroactiveOrderIds: string[] = [];

        if (consequence.action === "auto_approval_revoked") {
          await supabase
            .from("employees")
            .update({ auto_approval_revoked_at: nowIso })
            .eq("id", employeeId);

          const { data: recentAuto } = await supabase
            .from("qc_reviews")
            .select("order_id")
            .eq("employee_id", employeeId)
            .eq("status", "auto")
            .order("created_at", { ascending: false })
            .limit(consequence.retroactiveReviewCount);

          retroactiveOrderIds = (recentAuto || []).map((r) => r.order_id as string);
          if (retroactiveOrderIds.length > 0) {
            await supabase
              .from("qc_reviews")
              .update({ status: "pending", note: "Revisión retroactiva por manipulación detectada (E5.2)" })
              .in("order_id", retroactiveOrderIds);
          }
        } else {
          await supabase
            .from("employees")
            .update({
              trust_level: "suspended",
              suspension_reason: `Segunda detección de manipulación del muro QC (${(evaluation.rejectionRate * 100).toFixed(1)}% de rechazo en muestra de ${evaluation.sampleSize}). Revisión humana requerida antes de cualquier decisión de despido (B.2.23).`,
            })
            .eq("id", employeeId);
        }

        const { data: detectionRow } = await supabase
          .from("gaming_detections")
          .insert({
            employee_id: employeeId,
            detection_number: consequence.detectionNumber,
            triggering_qc_review_id: data.id,
            sampled_rejection_rate: evaluation.rejectionRate,
            action_taken: consequence.action,
            retroactive_review_order_ids: retroactiveOrderIds,
            notes: `Muestra: ${evaluation.sampleSize}, rechazados: ${evaluation.rejectedCount}`,
          })
          .select()
          .single();

        gamingDetection = detectionRow;
      }
    }

    return NextResponse.json({ review: data, gamingDetection }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
