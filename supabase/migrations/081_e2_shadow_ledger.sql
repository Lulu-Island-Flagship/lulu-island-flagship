-- Migración 081 — v8.3 E2: Shadow Ledger
--
-- Contexto (auditoría 2026-07-10): el plan (C.1, C.2.4, E2.5, C.3) nombra
-- explícitamente el "Shadow Ledger" como entregable de E2: "registro
-- operativo de toda transacción, separado de QBO, fuente de verdad
-- operativa cuando QBO no responde" y como invariante de degradación
-- elegante (C.2.4: "si QBO cae, el sistema opera con Shadow Ledger y
-- sincroniza al volver"). Hoy no existe ni tabla ni lógica. qbo_export_lines
-- (migración 023) es el formato de SALIDA hacia QBO, no la fuente de
-- verdad operativa independiente — si QBO está caído, hoy no hay dónde
-- registrar el evento de cobro/reembolso.
--
-- Diseño: shadow_ledger_entries es INDEPENDIENTE de QBO. Se escribe en el
-- mismo momento en que ocurre cada evento de dinero real (Stripe/PayPal),
-- ANTES o en paralelo a cualquier intento de sync con QBO, para que pueda
-- reconstruirse el estado financiero real aunque QBO esté caído. La
-- reconciliación 2:00 AM (E2.6, ya prevista en el plan pero no construida
-- en esta sesión) leería de aquí, no al revés.
--
-- Esta migración NO implementa el reintento automático a QBO (no hay un
-- patrón claro ya establecido para eso más allá de qbo_export_lines /
-- payment_recovery_notifications de 073). Solo deja la estructura y qué
-- debe loguearse, documentado abajo.
--
-- Propiedad de tabla: E2 (dinero). orders es leída solo por FK.

-- ============================================================
-- 1. Tabla shadow_ledger_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS shadow_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Qué pasó. Un evento por cada movimiento de dinero real (no proyectado).
  -- Cobertura mínima según los endpoints de dinero existentes hoy:
  --   hold_authorized       -- SetupIntent/PaymentIntent en requires_capture (E1)
  --   hold_captured         -- captura total/parcial del Hold (cancel, batch-capture)
  --   hold_released         -- cancelación >72h, o liberación de hold sobrante
  --   balance_captured      -- PaymentIntent del saldo restante (batch-capture)
  --   cancellation_penalty  -- captura de penalidad 24-72h / <24h (cancel route)
  --   paypal_advance_received -- anticipo 50% primera reserva (D.3)
  --   paypal_refund         -- reembolso >72h del anticipo PayPal
  --   capture_failed        -- intento fallido (batch-capture / retry 10PM)
  --   warranty_refund       -- ajuste/reembolso post-disputa (D.10.8, no
  --                            construido aún como endpoint; se deja el tipo
  --                            listo para cuando exista)
  event_type TEXT NOT NULL CHECK (event_type IN (
    'hold_authorized',
    'hold_captured',
    'hold_released',
    'balance_captured',
    'cancellation_penalty',
    'paypal_advance_received',
    'paypal_refund',
    'capture_failed',
    'warranty_refund'
  )),

  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Dinero. Siempre en cents CAD, siempre positivo; el signo/dirección lo
  -- da event_type (un 'paypal_refund' es dinero que SALE, pero se guarda
  -- como magnitud positiva + event_type para no depender de convención de
  -- signo implícita, que es una fuente común de bugs de conciliación).
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'cad',

  -- Con qué procesador ocurrió, y su referencia externa (para poder cruzar
  -- 1:1 contra el dashboard de Stripe/PayPal sin ambigüedad).
  payment_processor TEXT NOT NULL CHECK (payment_processor IN ('stripe', 'paypal', 'internal')),
  external_reference TEXT, -- PaymentIntent id / PayPal transaction id / null si internal

  -- Idempotencia: un mismo evento externo (mismo PI, mismo tipo) no debe
  -- duplicar entradas si el caller reintenta. Se construye determinísticamente
  -- en el caller (ver src/lib/shadow-ledger.ts) como
  -- `${event_type}:${external_reference ?? order_id}`.
  idempotency_key TEXT NOT NULL UNIQUE,

  -- Cuándo ocurrió el evento real vs. cuándo quedó registrado (pueden
  -- diverger si QBO/la app tuvo latencia; occurred_at es la fuente de
  -- verdad temporal para reconciliación).
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Estado de sincronización con QBO. La tabla es la fuente de verdad
  -- operativa INDEPENDIENTEMENTE de este estado — nunca se bloquea la
  -- escritura del evento esperando a QBO.
  sync_status TEXT NOT NULL DEFAULT 'pending_qbo_sync'
    CHECK (sync_status IN ('pending_qbo_sync', 'synced', 'sync_failed')),
  qbo_sync_attempts INTEGER NOT NULL DEFAULT 0,
  qbo_sync_last_error TEXT,
  qbo_sales_receipt_id TEXT, -- referencia asignada por QBO una vez sincronizado
  synced_at TIMESTAMPTZ,

  -- Contexto libre para reconstrucción/auditoría (p.ej. hold_amount,
  -- quote_total, capture_attempts en el momento del evento) sin tener que
  -- volver a joinear orders si esos valores ya cambiaron después.
  metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shadow_ledger_order ON shadow_ledger_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_shadow_ledger_sync_status ON shadow_ledger_entries(sync_status)
  WHERE sync_status <> 'synced';
CREATE INDEX IF NOT EXISTS idx_shadow_ledger_occurred_at ON shadow_ledger_entries(occurred_at);
CREATE INDEX IF NOT EXISTS idx_shadow_ledger_event_type ON shadow_ledger_entries(event_type);

ALTER TABLE shadow_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read shadow ledger" ON shadow_ledger_entries;
CREATE POLICY "Supervisors read shadow ledger" ON shadow_ledger_entries
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Solo el service role (que hace bypass de RLS) escribe aquí; no se otorga
-- INSERT/UPDATE a roles autenticados normales, a diferencia de
-- cron_execution_guard (073) que es de propósito general no financiero.
-- Este es dinero: escritura restringida por diseño, igual que
-- warranty_claims/qbo_export_lines.

-- ============================================================
-- 2. Feature flag — apagado por defecto (money feature, invariante A.8:
-- staging + tests de contrato antes de dinero real).
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'shadow_ledger_enabled',
  false,
  'E2',
  'Registro operativo independiente de QBO para cada evento de cobro/reembolso (fuente de verdad cuando QBO no responde)'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;
