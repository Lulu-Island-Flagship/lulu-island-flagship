-- Migración 080 — v8.3 E2: exclusión de disputas críticas del Batch Capture 7PM
--
-- Contexto (auditoría 2026-07-10): batch-capture/route.ts cobraba TODAS las
-- órdenes completadas del día sin excepción real; el propio archivo admitía
-- en un comentario que la regla de exclusión por disputa/discrepancia
-- crítica abierta no existía. Esto viola B.2.18 ("Única exclusión:
-- discrepancia crítica aún abierta, documentada como parte del flujo de
-- resolución") y el punto E2.3 del plan ("Única causa de exclusión: ticket
-- abierto CON evidencia contradictoria de las fotos").
--
-- Diseño: no toda disputa abierta bloquea el cobro (B.2.2 es explícito:
-- "El pago no se congela por defecto"). Solo bloquea una disputa que es
-- simultáneamente:
--   (a) status = 'open' (aún no resuelta)
--   (b) severity = 'critical' (discrepancia de nivel ≥2, D.10.3)
--   (c) tiene evidencia fotográfica aportada por el cliente ("documentada")
-- Este es el criterio operacionalizado de "discrepancia crítica documentada
-- aún abierta" cuando la comparación automática contra fotos de cierre
-- (E4, no construido aún) todavía no existe: mientras no haya evaluación
-- automática, cualquier disputa crítica CON evidencia del cliente se trata
-- como "no concluyente" y se escala a revisión humana (B.3.3), en vez de
-- cobrarse a ciegas.
--
-- Propiedad de tabla: warranty_claims es de Módulo 2 / E2. orders es leída
-- y escrita aquí solo en las columnas de captura (E2 es dueño de esas
-- columnas desde 001_modulo1_base_schema.sql y sucesivas). tickets_disputas
-- (010_modulo7_qc_score_tables.sql) se reusa como la cola de revisión
-- manual: ya es la bandeja priorizada existente, no se inventa una tabla
-- paralela.

-- ============================================================
-- 1. Severidad de la disputa en warranty_claims
-- ============================================================
ALTER TABLE warranty_claims
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'critical'));

COMMENT ON COLUMN warranty_claims.severity IS
  'minor: discrepancia de 1 nivel, no bloquea Batch Capture (D.10.3 lineal). '
  'critical: discrepancia de >=2 niveles; si sigue open Y tiene evidencia de '
  'cliente, bloquea el Batch Capture 7PM (B.2.2 / B.2.18).';

CREATE INDEX IF NOT EXISTS idx_warranty_claims_open_critical
  ON warranty_claims(order_id)
  WHERE status = 'open' AND severity = 'critical';

-- ============================================================
-- 2. Columnas de retención en orders (visibilidad directa sin JOIN)
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS capture_withheld_reason TEXT,
  ADD COLUMN IF NOT EXISTS capture_withheld_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_withheld_claim_id UUID REFERENCES warranty_claims(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_capture_withheld
  ON orders(id)
  WHERE capture_withheld_reason IS NOT NULL;

-- ============================================================
-- 3. tickets_disputas ya acepta type='discrepancy' desde 010; se agrega
-- una razón de contexto estándar para que el admin la reconozca en la
-- bandeja unificada. No se altera el CHECK de type (ya cubre 'discrepancy').
-- El campo context (JSONB) llevará: { order_id, warranty_claim_id,
-- reason: 'batch_capture_withheld_critical_dispute', quote_total, hold_amount }.
-- ============================================================

-- ============================================================
-- 4. Feature flag — apagado por defecto, como todos los flags de dinero
-- de este módulo (E2.3 requiere demo en staging + aprobación del dueño
-- antes de activar en producción, invariante A.8 / criterios E2).
-- ============================================================
INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'batch_capture_dispute_exclusion_enabled',
  false,
  'E2',
  'Excluir del Batch Capture 7PM las órdenes con disputa crítica abierta y documentada (B.2.2/B.2.18); encolar en tickets_disputas para revisión manual'
)
ON CONFLICT (nombre) DO UPDATE SET activo = false;
