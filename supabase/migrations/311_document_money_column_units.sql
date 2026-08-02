-- Migración 311 (auditoría externa de integridad financiera, 2026-08-02)
--
-- Contexto: orders/quotes mezclan columnas monetarias en DÓLARES enteros
-- (columnas legacy, tipo INTEGER, sin sufijo "_cents") con columnas en
-- CENTAVOS enteros (introducidas en la migración 229 "RAÍZ-3" y
-- posteriores, con sufijo "_cents"). Esta mezcla ya causó bugs reales de
-- redondeo/pérdida de precisión en el código de aplicación (ver fixes en
-- src/app/api/stripe/confirm/route.ts, src/app/api/cron/batch-capture/
-- route.ts, src/app/api/cron/batch-capture-retry/route.ts,
-- src/app/api/admin/orders/[id]/force-full-capture/route.ts,
-- src/app/api/quote/route.ts, src/app/api/quote/recalculate/route.ts y
-- src/app/api/admin/phone-booking/route.ts, todos corregidos en la misma
-- auditoría).
--
-- Esta migración NO cambia ningún tipo de columna ni renombra nada --
-- migrar todo el esquema a centavos es un cambio mayor que requiere
-- planificación aparte (backfill, ventana de mantenimiento, coordinación
-- con todos los consumidores de estas columnas) y está fuera de alcance
-- seguro para hacer sin supervisión directa. Este script SOLO documenta,
-- vía COMMENT ON COLUMN, la unidad real de cada columna monetaria hoy en
-- producción, para que nadie más cometa el mismo error de asumir la unidad
-- equivocada.

-- orders: columnas en DÓLARES enteros (legacy, sin sufijo "_cents")
comment on column public.orders.paypal_advance_amount is
  'UNIDAD: DÓLARES enteros (NO centavos), a diferencia de la mayoría de columnas monetarias de orders. Anticipo real cobrado por PayPal en el flujo "paypal_first_time". Escalar x100 al operar junto a columnas *_cents. Ver auditoría 2026-08-02 y RAÍZ-3 (migración 229, que NO tocó esta columna).';

comment on column public.orders.capture_partial_amount is
  'UNIDAD: DÓLARES enteros (NO centavos). Monto capturado de inmediato en el batch de 7PM cuando había disputa crítica documentada (costo laboral + 10%). NULL si nunca aplicó captura parcial. Escalar x100 al operar junto a columnas *_cents. Ver auditoría 2026-08-02.';

comment on column public.orders.capture_remaining_amount is
  'UNIDAD: DÓLARES enteros (NO centavos). Monto pendiente de cobrar a las 24h tras una captura parcial. 0 (no NULL) una vez capturado. Escalar x100 al operar junto a columnas *_cents. Ver auditoría 2026-08-02.';

comment on column public.orders.capture_authorized_amount is
  'UNIDAD: CENTAVOS enteros pese a no llevar sufijo "_cents" en el nombre -- se escribe desde amountReceivedCents (ver src/lib/payment-capture-reconciliation.ts). No confundir con paypal_advance_amount/capture_partial_amount/capture_remaining_amount, que sí están en dólares. Ver auditoría 2026-08-02.';

-- orders: columnas ya en CENTAVOS (documentando explícitamente las que aún
-- no tenían comentario, para que el criterio quede completo en el esquema)
comment on column public.orders.installment_first_amount_cents is
  'UNIDAD: CENTAVOS enteros. Primera cuota del plan de pago fraccionado 50/50 (v8.3 E2.10).';

comment on column public.orders.installment_second_amount_cents is
  'UNIDAD: CENTAVOS enteros. Segunda cuota del plan de pago fraccionado 50/50 (v8.3 E2.10).';

comment on column public.orders.stripe_amount_refunded_cents is
  'UNIDAD: CENTAVOS enteros. Último acumulado de Stripe charge.amount_refunded procesado por el webhook. Ver auditoría 2026-07-21, B-P2-1.';

comment on column public.orders.wallet_refunded_amount_cents is
  'UNIDAD: CENTAVOS enteros. Suma de reembolsos ya emitidos contra wallet_payment_intent_id.';

-- quotes: columnas en DÓLARES enteros (INTEGER, sin decimales -- pierden
-- centavos si el subtotal calculado trae fracción de dólar; el código de
-- aplicación redondea explícitamente antes de escribir, ver auditoría
-- 2026-08-02)
comment on column public.quotes.subtotal is
  'UNIDAD: DÓLARES enteros (columna INTEGER, sin decimales). A diferencia de total/gst/pst (NUMERIC(10,2)), esta columna NO puede representar centavos -- el código de aplicación (src/app/api/quote/route.ts, quote/recalculate/route.ts, admin/phone-booking/route.ts) redondea explícitamente con Math.round() antes de escribir. Ver auditoría 2026-08-02.';

comment on column public.quotes.hold_amount is
  'UNIDAD: DÓLARES enteros (columna INTEGER). Monto del Hold de seguridad (T-72h) calculado para esta quote; se escala x100 al copiarse a orders.hold_amount_cents al crear la orden (ver src/app/api/stripe/confirm/route.ts). Ver auditoría 2026-08-02.';

comment on column public.quotes.total is
  'UNIDAD: dólares con centavos (NUMERIC(10,2)). A diferencia de subtotal/hold_amount (INTEGER, solo dólares enteros), sí preserva centavos. Ver auditoría 2026-08-02.';

comment on column public.quotes.gst is
  'UNIDAD: dólares con centavos (NUMERIC(10,2)).';

comment on column public.quotes.pst is
  'UNIDAD: dólares con centavos (NUMERIC(10,2)).';
