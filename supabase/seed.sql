-- Seed: datos falsos de staging para Lulu Island Flagship v8.3
-- Ejecuta automáticamente con `supabase db reset` después de las migraciones.
-- Contraseña por defecto de todos los usuarios de prueba: "password"

-- crypt()/gen_salt() viven en la extensión pgcrypto (schema extensions en Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path TO public, extensions;

-- El trigger de snapshots (E0-C6) exige motivo en todo UPDATE de tablas de
-- configuración — el seed lo declara para toda la sesión:
-- El tercer argumento `true` hace que el valor sea local a la TRANSACCIÓN
-- (persiste a través de todos los statements del seed) en vez de local solo
-- al comando actual (`false`), que lo perdía inmediatamente después de este
-- SELECT y dejaba el resto del seed sin app.change_reason.
SELECT set_config('app.change_reason', 'db reset: seed de staging v8.3', true);

-- ============================================================
-- SALVAGUARDA: este archivo NUNCA debe correr contra producción
-- ============================================================
-- `supabase db reset` (que ejecuta este seed.sql automáticamente después de
-- las migraciones) es una herramienta SOLO para entornos locales/staging.
-- BORRA y recrea toda la base de datos y luego siembra usuarios de prueba
-- con contraseña en texto plano "password" (incluye un owner_admin
-- permanente, aeonwalk3r@gmail.com, y 7 cuentas @example.com). Contra un
-- proyecto de producción esto sería catastrófico e irreversible.
--
-- En producción NUNCA se debe ejecutar `supabase db reset`. Solo se aplican
-- migraciones (`supabase db push` o el flujo de CI/CD correspondiente), que
-- no tocan este archivo.
--
-- NOTA (corregido 2026-07-20): una versión anterior de esta salvaguarda
-- exigía un `set_config` manual antes de correr el archivo, bloqueando con
-- RAISE EXCEPTION si no estaba presente. Se revirtió porque rompía el
-- flujo normal de `supabase start`/`db reset` en local (ambos ejecutan
-- este seed en un solo paso automático, sin oportunidad de fijar esa
-- variable antes) sin aportar protección real: `supabase db reset` es un
-- comando que SOLO opera sobre el stack local de Docker -- no existe forma
-- de que apunte al proyecto de producción por esa vía (para aplicar
-- migraciones a producción se usa `supabase db push`, que nunca ejecuta
-- seed.sql). El único escenario de riesgo real es que alguien copie este
-- archivo a mano en una sesión de `psql` conectada directo a producción --
-- contra eso, un bloqueo por variable mágica no protege nada (se bypassea
-- con la misma facilidad que se lee este comentario). La protección real
-- contra ESE escenario es la advertencia de arriba, bien visible antes de
-- cualquier INSERT.

-- ============================================================
-- 1. Usuarios de prueba (auth.users)
-- ============================================================
-- HALLAZGO REAL (verificación visual, 2026-07-11): este INSERT nunca fijaba
-- instance_id/aud/role, dejándolos en NULL. GoTrue busca usuarios existentes
-- filtrando por instance_id = '00000000-0000-0000-0000-000000000000' (el
-- UUID cero estándar de instalaciones self-hosted de un solo tenant); con
-- NULL no los encuentra, intenta CREAR un usuario nuevo con el mismo email,
-- choca contra el índice único parcial de auth.users, la transacción queda
-- abortada, y las conexiones/bloqueos resultantes hacen que TODAS las
-- peticiones siguientes a /auth/v1/otp den timeout 504 (confirmado: pasa
-- igual con owner@example.com, no es específico de ninguna cuenta). Fijar
-- estas tres columnas es exactamente lo que hace el signup normal de
-- Supabase Auth; no cambia el comportamiento de RLS ni de permisos.
--
-- SEGUNDO HALLAZGO (mismo día, misma auditoría): confirmation_token,
-- recovery_token y email_change_token_new NO tienen default a nivel de
-- columna (a diferencia de sus primas phone_change/email_change_token_current/
-- reauthentication_token, que sí default a ''). El código Go de GoTrue las
-- escanea como string plano, no nullable -- con NULL truena en runtime:
-- "converting NULL to string is unsupported". Confirmado vía
-- `docker logs supabase_auth_...`. Se fijan a '' explícitamente, igual que
-- hace el signup real.
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  phone_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, '3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid, 'authenticated', 'authenticated', 'owner@example.com',      crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner Admin"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, '9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, 'authenticated', 'authenticated', 'supervisor@example.com', crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Supervisor Test"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, '64e35c23-b883-470b-8f20-23ffb6f40982'::uuid, 'authenticated', 'authenticated', 'cleaner@example.com',    crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Cleaner Test"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ceef1739-57f5-45fc-ae34-e75e7bfb12c7'::uuid, 'authenticated', 'authenticated', 'driver@example.com',     crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Driver Test"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid, 'authenticated', 'authenticated', 'client_b2c@example.com', crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Cliente B2C"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid, 'authenticated', 'authenticated', 'client_b2b@example.com', crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Cliente B2B"}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, '7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60'::uuid, 'authenticated', 'authenticated', 'qc@example.com',         crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"QC Only Test"}'),
  -- Dueño real (Aeon): sembrado con UUID fijo para que su acceso de
  -- owner_admin sobreviva a cada `db reset` sin tener que reinsertar
  -- admin_roles a mano. Entra por el login de email+código de
  -- src/components/admin/AdminLoginScreen.tsx (signInWithOtp busca por
  -- email y autentica esta MISMA fila, no crea una cuenta duplicada).
  ('00000000-0000-0000-0000-000000000000'::uuid, 'aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae'::uuid, 'authenticated', 'authenticated', 'aeonwalk3r@gmail.com',   crypt('password', gen_salt('bf')), now(), now(), '', '', '', '', now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aeon Walker"}')
ON CONFLICT (id) DO UPDATE SET
  instance_id = EXCLUDED.instance_id,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role,
  confirmation_token = EXCLUDED.confirmation_token,
  recovery_token = EXCLUDED.recovery_token,
  email_change_token_new = EXCLUDED.email_change_token_new,
  email_change = EXCLUDED.email_change,
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  updated_at = now();

-- Identidades de auth para cada usuario (requerido por Supabase Auth)
-- provider_id es NOT NULL en versiones recientes de Supabase Auth: para el
-- provider 'email' equivale al sub (id del usuario) en texto.
INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  created_at,
  updated_at
) VALUES
  ('3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid, '3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid, '3e27c46c-c0b3-4583-b33c-a2ca82024232', '{"sub":"3e27c46c-c0b3-4583-b33c-a2ca82024232","email":"owner@example.com"}',      'email', now(), now()),
  ('9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, '9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, '9739d2ba-8b59-481f-9325-f6c029ff6763', '{"sub":"9739d2ba-8b59-481f-9325-f6c029ff6763","email":"supervisor@example.com"}', 'email', now(), now()),
  ('64e35c23-b883-470b-8f20-23ffb6f40982'::uuid, '64e35c23-b883-470b-8f20-23ffb6f40982'::uuid, '64e35c23-b883-470b-8f20-23ffb6f40982', '{"sub":"64e35c23-b883-470b-8f20-23ffb6f40982","email":"cleaner@example.com"}',    'email', now(), now()),
  ('ceef1739-57f5-45fc-ae34-e75e7bfb12c7'::uuid, 'ceef1739-57f5-45fc-ae34-e75e7bfb12c7'::uuid, 'ceef1739-57f5-45fc-ae34-e75e7bfb12c7', '{"sub":"ceef1739-57f5-45fc-ae34-e75e7bfb12c7","email":"driver@example.com"}',     'email', now(), now()),
  ('a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid, 'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid, 'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3', '{"sub":"a8bb80d1-1841-4dbe-a569-42d9f5d50cc3","email":"client_b2c@example.com"}', 'email', now(), now()),
  ('93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid, '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid, '93e41cd3-7ef5-4892-a144-69da2cf41189', '{"sub":"93e41cd3-7ef5-4892-a144-69da2cf41189","email":"client_b2b@example.com"}', 'email', now(), now()),
  ('7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60'::uuid, '7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60'::uuid, '7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60', '{"sub":"7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60","email":"qc@example.com"}',          'email', now(), now()),
  ('aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae'::uuid, 'aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae'::uuid, 'aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae', '{"sub":"aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae","email":"aeonwalk3r@gmail.com"}',    'email', now(), now())
ON CONFLICT (id) DO UPDATE SET
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

-- ============================================================
-- 1b. Roles ADMINISTRATIVOS (v8.3 E0-C3 — RBAC, M0 Fase 0.9)
-- owner_admin: todo | ops_coordinator: sin finanzas/nómina | qc_only: muro QC
-- ============================================================
INSERT INTO admin_roles (user_id, role, granted_by) VALUES
  ('3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid, 'owner_admin',     '3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid),
  ('9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, 'ops_coordinator', '3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid),
  ('7c1de5a2-0f3b-4a8d-9e56-1b2c3d4e5f60'::uuid, 'qc_only',         '3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid),
  ('aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae'::uuid, 'owner_admin',     'aeaeaeae-1111-4aaa-8aaa-aeaeaeaeaeae'::uuid)
ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================================
-- 2. Perfiles y clientes
-- ============================================================
INSERT INTO profiles (id, full_name, phone, created_at, updated_at) VALUES
  ('3e27c46c-c0b3-4583-b33c-a2ca82024232'::uuid, 'Owner Admin',      '+1-604-000-0000', now(), now()),
  ('9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, 'Supervisor Test',  '+1-604-000-0001', now(), now()),
  ('64e35c23-b883-470b-8f20-23ffb6f40982'::uuid, 'Cleaner Test',     '+1-604-000-0002', now(), now()),
  ('ceef1739-57f5-45fc-ae34-e75e7bfb12c7'::uuid, 'Driver Test',      '+1-604-000-0003', now(), now()),
  ('a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid, 'Cliente B2C',      '+1-604-000-1000', now(), now()),
  ('93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid, 'Cliente B2B',      '+1-604-000-1001', now(), now())
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO client_profiles (
  id, user_id, score, services_count, disputes_count, disputes_lost_count,
  no_show_count, account_type, company_name, payment_terms,
  consent_photo_marketing, photo_marketing_version, created_at, updated_at
) VALUES
  ('facdc39c-caa7-417c-af99-9fc7d6b46d52'::uuid, 'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid, 75, 2, 0, 0, 0, 'b2c', NULL, NULL, false, 'v1.0', now(), now()),
  ('8ec734f8-de11-46d9-abbd-efe871aee8cd'::uuid, '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid, 60, 5, 0, 0, 0, 'b2b', 'Lulu Properties Inc.', 'net_30', false, 'v1.0', now(), now())
ON CONFLICT (user_id) DO UPDATE SET
  score = EXCLUDED.score,
  services_count = EXCLUDED.services_count,
  updated_at = now();

-- client_wallets se crea automáticamente por trigger; forzamos saldo para B2B
UPDATE client_wallets
SET balance = 5000
WHERE user_id = '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid;

INSERT INTO client_properties (
  id, client_profile_id, nickname, address, zone, postal_code, square_feet, is_active, created_at, updated_at
) VALUES
  ('d0e4e616-cc7a-4c3d-8d7f-331938508479'::uuid, 'facdc39c-caa7-417c-af99-9fc7d6b46d52'::uuid, 'Casa Richmond', '123 Main St, Richmond, BC', 'Richmond', 'V6Y 1A1', 1200, true, now(), now()),
  ('c92f25a0-2efe-421b-b702-b7d4f9a6c6d5'::uuid, '8ec734f8-de11-46d9-abbd-efe871aee8cd'::uuid, 'Oficina Steveston', '456 Bayview Ave, Richmond, BC', 'Richmond', 'V7E 2P5', 2500, true, now(), now())
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  address = EXCLUDED.address,
  updated_at = now();

-- ============================================================
-- 3. Vehículos y empleados
-- ============================================================
INSERT INTO vehicles (id, name, plate, is_active, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Van 1', 'LULU-001', true, now(), now()),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Van 2', 'LULU-002', true, now(), now())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  plate = EXCLUDED.plate,
  updated_at = now();

INSERT INTO employees (
  id, user_id, name, email, phone, role, day_rate, languages,
  is_active, trust_level, base_schedule_minutes, contingency_minutes,
  home_zone, vehicle_id, min_wage_floor_enabled, qc_score_threshold,
  qc_bonus_per_point, max_rework_minutes, created_at, updated_at
) VALUES
  ('33333333-3333-3333-3333-333333333333'::uuid, '9739d2ba-8b59-481f-9325-f6c029ff6763'::uuid, 'Supervisor Test',  'supervisor@example.com', '+1-604-000-0001', 'supervisor', 25000, ARRAY['en','fr'], true, 'standard', 480, 120, 'Richmond', NULL, true, 70, 100, 30, now(), now()),
  ('44444444-4444-4444-4444-444444444444'::uuid, '64e35c23-b883-470b-8f20-23ffb6f40982'::uuid, 'Cleaner Test',     'cleaner@example.com',    '+1-604-000-0002', 'cleaner',    20000, ARRAY['en'],     true, 'standard', 480, 120, 'Richmond', '11111111-1111-1111-1111-111111111111'::uuid, true, 70, 0, 30, now(), now()),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'ceef1739-57f5-45fc-ae34-e75e7bfb12c7'::uuid, 'Driver Test',      'driver@example.com',     '+1-604-000-0003', 'driver',     22000, ARRAY['en','zh'],  true, 'standard', 480, 120, 'Richmond', '11111111-1111-1111-1111-111111111111'::uuid, true, 70, 0, 30, now(), now())
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = now();

-- ============================================================
-- 4. Configuración base (idempotente, no rompe migraciones previas)
-- ============================================================
INSERT INTO pricing_settings (target_hourly_rate, effective_from, reason)
SELECT 70.00, '2026-06-01', 'Seed inicial v8.3'
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_settings WHERE effective_from = '2026-06-01' AND effective_to IS NULL
);

INSERT INTO payroll_settings (bc_min_wage_hourly, effective_from)
SELECT 18.25, '2024-06-01'
WHERE NOT EXISTS (
  SELECT 1 FROM payroll_settings WHERE effective_from = '2024-06-01' AND effective_to IS NULL
);

INSERT INTO chargeback_settings (reserve_percentage, effective_from)
SELECT 2.00, '2026-06-01'
WHERE NOT EXISTS (
  SELECT 1 FROM chargeback_settings WHERE effective_from = '2026-06-01' AND effective_to IS NULL
);

INSERT INTO feature_flags (nombre, activo, modulo, descripcion) VALUES
  ('modulo_1_cotizador',           true,  'Módulo 1', 'Cotizador B2C con precio transparente'),
  ('modulo_2_pagos',               false, 'Módulo 2', 'Stripe SetupIntent + Batch Capture'),
  ('modulo_3_empleado',            true,  'Módulo 3', 'PWA del empleado'),
  ('modulo_3_capacity_dispatch',   true,  'Módulo 3', 'Capacidad y despacho'),
  ('modulo_4_pwa',                 false, 'Módulo 4', 'PWA líder offline-first'),
  ('modulo_5_marketing',           false, 'Módulo 5', 'Marketing in-situ y retención'),
  ('modulo_6_excepciones',         false, 'Módulo 6', 'Orquestación de excepciones'),
  ('modulo2_payment_flow_v2',      false, 'Módulo 2', 'Hold T-72h + Capture 7PM'),
  ('warranty_photo_enabled',       false, 'Módulo 2', 'Garantía fotográfica'),
  ('paypal_first_service_enabled', false, 'Módulo 2', 'PayPal primer servicio'),
  ('recurring_contracts_enabled',  false, 'Módulo 2', 'Contratos recurrentes'),
  ('qbo_export_enabled',           false, 'Módulo 2', 'Exportación QBO'),
  ('chargeback_reserve_enabled',   false, 'Módulo 2', 'Reserva de chargebacks'),
  ('lulu_wallet_enabled',          false, 'Módulo 2', 'Billetera Lulu')
ON CONFLICT (nombre) DO UPDATE SET
  activo = EXCLUDED.activo,
  modulo = EXCLUDED.modulo,
  descripcion = EXCLUDED.descripcion;

-- ============================================================
-- 5. Cotizaciones y órdenes de ejemplo
-- ============================================================
INSERT INTO quotes (
  id, user_id, service_category, service_subtype, service_type,
  bedrooms, bathrooms, square_feet, pets_count, pets_type, residents,
  days_since_cleaning, address, zone, postal_code, day_of_week, is_preferred_day,
  base_price, organic_multiplier, organic_adjustment, recency_multiplier, recency_adjustment,
  zone_surcharge, logistics_surcharge, rule_adjustment, applied_rules,
  subtotal, gst, pst, total, hold_amount, price_frozen_until, status,
  admin_review_required, admin_review_reason, estimated_labor_cost,
  estimated_margin_contribution,
  consent_tc, consent_pipa, consent_marketing,
  tc_version, pipa_version, marketing_version,
  consent_ip, consent_accepted_at, client_score,
  created_at, updated_at
) VALUES
  (
    '66666666-6666-6666-6666-666666666666'::uuid,
    'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid,
    'residential', 'first_time', 'deep',
    2, 2, 1200, 0, 'none', 2,
    45, '123 Main St, Richmond, BC', 'Richmond', 'V6Y 1A1', 3, true,
    28000, 1.00, 0, 1.15, 0,
    0, 0, 0, '[]'::jsonb,
    32200, 1610.00, 2254.00, 36064.00, 14426,
    now() + interval '10 minutes', 'reserved',
    false, NULL, 15000, 0.30,
    true, true, false,
    'v1.0', 'v1.0', 'v1.0',
    '127.0.0.1', now(), 75,
    now(), now()
  ),
  (
    '77777777-7777-7777-7777-777777777777'::uuid,
    '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid,
    'commercial', 'regular', 'regular',
    3, 2, 2500, 0, 'none', 5,
    15, '456 Bayview Ave, Richmond, BC', 'Richmond', 'V7E 2P5', 1, false,
    35000, 1.00, 0, 0.85, 0,
    0, 0, 0, '[]'::jsonb,
    29750, 1487.50, 2082.50, 33320.00, 13328,
    now() + interval '10 minutes', 'pending',
    false, NULL, 12500, 0.35,
    true, true, false,
    'v1.0', 'v1.0', 'v1.0',
    '127.0.0.1', now(), 60,
    now(), now()
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  price_frozen_until = EXCLUDED.price_frozen_until,
  updated_at = now();

INSERT INTO orders (
  id, quote_id, user_id, service_date, service_time, service_datetime,
  status, stripe_customer_id, stripe_payment_method_id, stripe_setup_intent_id,
  payment_option, hold_amount_cents, cancellation_window_hours,
  admin_review_required, admin_review_reason,
  review_token, review_token_used_at,
  address_lat, address_lng,
  wallet_amount_used_cents, card_amount_charged_cents, total_paid_cents,
  pipa_alt_requires_audit, purchase_order,
  qbo_export_status, warranty_status,
  created_at, updated_at
) VALUES
  (
    '88888888-8888-8888-8888-888888888888'::uuid,
    '66666666-6666-6666-6666-666666666666'::uuid,
    'a8bb80d1-1841-4dbe-a569-42d9f5d50cc3'::uuid,
    '2026-07-10', '10:00:00', '2026-07-10T17:00:00Z',
    'confirmed', NULL, NULL, NULL,
    'card', 1442600, 72,
    false, NULL,
    NULL, NULL,
    49.166592, -123.133568,
    0, 0, 0,
    false, NULL,
    'pending', 'none',
    now(), now()
  ),
  (
    '99999999-9999-9999-9999-999999999999'::uuid,
    '77777777-7777-7777-7777-777777777777'::uuid,
    '93e41cd3-7ef5-4892-a144-69da2cf41189'::uuid,
    '2026-07-09', '14:00:00', '2026-07-09T21:00:00Z',
    'completed', NULL, NULL, NULL,
    'card', 1332800, 72,
    false, NULL,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    49.166592, -123.133568,
    0, 0, 0,
    false, 'PO-2026-001',
    'pending', 'none',
    now(), now()
  )
ON CONFLICT (quote_id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();

-- ============================================================
-- 6. Asignaciones y logs de servicio
-- ============================================================
INSERT INTO assignments (id, order_id, employee_id, assigned_at, status, notes, created_at, updated_at) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '88888888-8888-8888-8888-888888888888'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, now(), 'pending', 'Asignación confirmada', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, now() - interval '2 hours', 'completed', 'Servicio completado', now(), now())
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO service_logs (id, order_id, employee_id, event_type, timestamp, location_lat, location_lng, notes, created_at) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 't_in',  now() - interval '3 hours', 49.166592, -123.133568, 'Llegada registrada', now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 't_out', now() - interval '1 hour',  49.166592, -123.133568, 'Cierre registrado',  now())
ON CONFLICT (id) DO UPDATE SET
  timestamp = EXCLUDED.timestamp,
  notes = EXCLUDED.notes;

-- ============================================================
-- 7. QC review manual para la orden completada
-- ============================================================
INSERT INTO qc_reviews (id, order_id, employee_id, reviewer_id, status, note, reviewed_at, sampling_reason, created_at) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'approved', 'QC aprobado en seed', now(), 'seed', now())
ON CONFLICT (order_id) DO UPDATE SET
  status = EXCLUDED.status,
  reviewed_at = EXCLUDED.reviewed_at;

-- ============================================================
-- 8. Nómina de ejemplo (pendiente)
-- ============================================================
INSERT INTO payroll_entries (
  id, employee_id, order_id, assignment_id, day_rate, estimated_service_minutes,
  rework_minutes, qc_score, base_amount, qc_bonus_amount, qc_penalty_amount,
  rework_paid_minutes, rework_amount, hourly_equivalent, minimum_wage_adjustment,
  gross_amount, status, notes, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    '99999999-9999-9999-9999-999999999999'::uuid,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    20000, 480, 0, 85,
    20000, 1500, 0, 0, 0,
    44.79, 0, 21500, 'pending', 'Nómina seed',
    now(), now()
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();

-- ============================================================
-- 9. Ticket de ejemplo (cola de soporte)
-- ============================================================
INSERT INTO tickets_disputas (
  id, order_id, employee_id, type, priority, status, context, resolution_note,
  created_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000002'::uuid,
    '88888888-8888-8888-8888-888888888888'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    'consulta', 'medium', 'open',
    '{"subject":"Duda sobre horario","channel":"app"}'::jsonb, NULL,
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status;

-- ============================================================
-- 10. E6 — Plantillas de comunicación iniciales (voz de marca D.8:
-- cálida y directa; "Tu equipo está en camino", nunca corporativo-genérico)
-- ============================================================
INSERT INTO communication_templates (event_key, language, version, body) VALUES
  ('order_confirmed', 'en', 1, 'Hi {client_name}! Your {service_type} is confirmed for {service_date}, {time_window}. Full price: {total} — charged only after service completion. — {company_name}'),
  ('order_confirmed', 'fr', 1, 'Bonjour {client_name}! Votre {service_type} est confirmé pour le {service_date}, {time_window}. Prix total : {total} — facturé seulement après la fin du service. — {company_name}'),
  ('order_confirmed', 'zh', 1, '{client_name}您好！您的{service_type}已确认，时间为{service_date} {time_window}。全价：{total} — 服务完成后才收费。— {company_name}'),
  ('team_en_route', 'en', 1, '{client_name}, your team is on the way! ETA: {eta_minutes} min. Track: {tracking_link}'),
  ('team_en_route', 'fr', 1, '{client_name}, votre équipe est en route ! Arrivée dans {eta_minutes} min. Suivez le trajet : {tracking_link}'),
  ('team_en_route', 'zh', 1, '{client_name}，您的团队正在路上！预计{eta_minutes}分钟到达。追踪：{tracking_link}'),
  ('service_completed', 'en', 1, 'All done, {client_name}! See your closing photos: {gallery_link}. Payment processes today at 7:00 PM. Anything not matching the photos? Report it — we review every case against the evidence.'),
  ('service_completed', 'fr', 1, 'C''est terminé, {client_name} ! Consultez vos photos de fin de service : {gallery_link}. Le paiement sera traité aujourd''hui à 19h00. Quelque chose ne correspond pas aux photos ? Signalez-le — nous examinons chaque cas avec les preuves à l''appui.'),
  ('service_completed', 'zh', 1, '完成了，{client_name}！查看收尾照片：{gallery_link}。款项今天晚上7点处理。如有与照片不符之处请反馈 — 我们逐一核对证据。'),
  ('review_request', 'en', 1, 'Thank you {client_name}! If you have 30 seconds, a Google review helps our small team a lot: {review_link}'),
  ('review_request', 'fr', 1, 'Merci {client_name} ! Si vous avez 30 secondes, un avis Google aide énormément notre petite équipe : {review_link}'),
  ('review_request', 'zh', 1, '谢谢您，{client_name}！如果您有30秒时间，Google评价对我们的小团队帮助很大：{review_link}')
ON CONFLICT (event_key, language, version) DO NOTHING;
