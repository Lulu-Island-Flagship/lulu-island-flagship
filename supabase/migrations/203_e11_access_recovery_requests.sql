-- v8.3 E11 — Recuperación de acceso inmediata vía contacto de confianza.
--
-- Distinto de Modo Sucesión (050_e11_succession_neighborhood.sql): sucesión
-- es continuidad del NEGOCIO tras 10-21 días de inactividad del dueño.
-- Esto es recuperación de ACCESO inmediata (Google/dispositivo perdido),
-- iniciada por un trusted_successor sin esperar ningún umbral de días.
--
-- trusted_successors son solo contactos (nombre/teléfono/notas) -- NUNCA
-- tienen cuenta propia en auth.users (ver comentario en 050_...). Por lo
-- tanto este flujo completo NO puede depender de sesión autenticada del
-- successor: los endpoints públicos (src/app/api/recovery/*) verifican
-- identidad por posesión de un código enviado al canal YA REGISTRADO de
-- antemano en trusted_successors -- nunca a un contacto que el solicitante
-- escriba en el momento. Esa es la garantía central contra suplantación.
--
-- Flujo:
--   1. pending_verification: alguien dice "soy <contacto X>, necesito
--      recuperar acceso", el sistema busca X en trusted_successors y manda
--      un código al contact_phone/contact_email YA GUARDADO de ese registro.
--   2. verified_pending_approval: el código correcto se recibió a tiempo.
--      Dispara alerta a la bandeja unificada + notifica a TODOS los demás
--      trusted_successors activos -- imposible que pase en secreto. NINGÚN
--      acceso se otorga en este paso.
--   3. approved: un segundo humano con capacidad de aprobar lo confirma --
--      o bien un owner_admin ya autenticado (admin/access-recovery), o bien
--      un SEGUNDO trusted_successor distinto, verificado con su propio
--      código contra SU propio contacto registrado (doble verificación).
--      Solo entonces se emite un código de respaldo de un solo uso,
--      reusando la MISMA tabla/mecanismo que 194_e0_owner_admin_backup_codes
--      (no se duplica infraestructura).
--   4. denied / expired: sin acceso otorgado.

CREATE TABLE IF NOT EXISTS access_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  successor_id UUID NOT NULL REFERENCES trusted_successors(id),
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified_pending_approval', 'approved', 'denied', 'expired')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),

  -- Verificación de identidad del solicitante (paso 1-2)
  verification_method TEXT CHECK (verification_method IN ('sms', 'email')),
  verification_code_hash TEXT,
  verification_code_expires_at TIMESTAMPTZ,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,

  -- Doble verificación opcional: un SEGUNDO trusted_successor distinto
  -- confirma con su propio código contra su propio contacto registrado.
  -- Es una de las dos vías de "aprobación humana" (la otra es el admin
  -- endpoint). Nunca es la misma persona que successor_id.
  co_verifier_successor_id UUID REFERENCES trusted_successors(id),
  co_verification_code_hash TEXT,
  co_verification_code_expires_at TIMESTAMPTZ,
  co_verification_attempts INTEGER NOT NULL DEFAULT 0,
  co_verified_at TIMESTAMPTZ,

  -- Resolución (paso 3-4)
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT, -- etiqueta legible: 'admin:<email>' o 'successor_co_verification:<nombre>' o 'system:expired'
  resolved_by_admin_user_id UUID REFERENCES auth.users(id),
  resolved_by_successor_id UUID REFERENCES trusted_successors(id),
  denial_reason TEXT,
  emergency_code_issued_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT co_verifier_not_requester CHECK (co_verifier_successor_id IS NULL OR co_verifier_successor_id <> successor_id)
);

CREATE INDEX IF NOT EXISTS idx_access_recovery_requests_successor ON access_recovery_requests(successor_id);
CREATE INDEX IF NOT EXISTS idx_access_recovery_requests_status ON access_recovery_requests(status);

-- Nunca se borra físicamente (invariante B.2.9) -- una solicitud denegada o
-- expirada queda como rastro, igual que un intento de acceso fallido real.
DROP TRIGGER IF EXISTS trg_prevent_delete ON access_recovery_requests;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON access_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE access_recovery_requests ENABLE ROW LEVEL SECURITY;

-- Sin acceso directo de cliente en absoluto -- ni siquiera de lectura para
-- owner_admin autenticado vía el cliente RLS-scoped. Todo el flujo (incluido
-- el panel admin de aprobación) opera con getServiceRoleClient() desde las
-- rutas de API, que hacen su propia autorización explícita (requireAdminRole
-- para el camino admin; posesión de código de un solo uso para el camino de
-- successor). Mismo patrón que rate_limits (012) y las tablas 'admin-only
-- vía service role' documentadas en src/lib/admin.ts.
CREATE POLICY "No direct client access" ON access_recovery_requests
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE access_recovery_requests IS
  'v8.3 E11: recuperación de acceso INMEDIATA (no sucesión) iniciada por un trusted_successor. RLS: solo service role. Ver src/app/api/recovery/* y src/app/api/admin/access-recovery/route.ts.';

-- ============================================================
-- Log de auditoría inmutable del flujo completo (requisito explícito: nada
-- de este flujo delicado puede pasar sin rastro, y el rastro no se puede
-- editar ni borrar después, ni siquiera por un owner_admin).
-- ============================================================
CREATE TABLE IF NOT EXISTS access_recovery_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES access_recovery_requests(id), -- NULL permitido: intentos que no llegaron a crear una solicitud (ej. contacto no coincide con ningún successor -- ver nota anti-enumeración abajo)
  event_type TEXT NOT NULL CHECK (event_type IN (
    'request_lookup_attempt', 'request_created', 'verification_code_sent',
    'verification_succeeded', 'verification_failed', 'verification_expired',
    'other_successors_notified', 'unified_alert_published',
    'co_verification_code_sent', 'co_verification_succeeded', 'co_verification_failed',
    'admin_approved', 'admin_denied', 'emergency_code_issued'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('successor', 'admin', 'system')),
  actor_ref TEXT, -- referencia NO sensible: contacto enmascarado (maskPhoneNumber/maskEmail), o user_id de admin, o 'system'
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_recovery_audit_log_request ON access_recovery_audit_log(request_id, created_at);

-- Verdaderamente inmutable: bloquea DELETE (patrón estándar) Y UPDATE (patrón
-- de experiment_assignments/disaster_recovery_drills -- función dedicada en
-- vez de reusar prevent_hard_delete, que solo cubre DELETE).
DROP TRIGGER IF EXISTS trg_prevent_delete ON access_recovery_audit_log;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON access_recovery_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE OR REPLACE FUNCTION prevent_access_recovery_audit_log_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'access_recovery_audit_log es inmutable -- ninguna fila se edita después de escrita (invariante de auditoría de seguridad)'
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_update ON access_recovery_audit_log;
CREATE TRIGGER trg_prevent_update BEFORE UPDATE ON access_recovery_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_access_recovery_audit_log_update();

ALTER TABLE access_recovery_audit_log ENABLE ROW LEVEL SECURITY;

-- Lectura permitida a owner_admin (auditoría) vía cliente RLS-scoped normal;
-- escritura exclusiva de service role (las rutas de API insertan con
-- getServiceRoleClient(), igual que access_recovery_requests).
CREATE POLICY "owner_admin reads recovery audit log" ON access_recovery_audit_log
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));
CREATE POLICY "No direct client writes" ON access_recovery_audit_log
  FOR INSERT WITH CHECK (false);

COMMENT ON TABLE access_recovery_audit_log IS
  'v8.3 E11: bitácora inmutable (bloquea UPDATE y DELETE) del flujo completo de recuperación de acceso. Nunca guarda códigos en texto plano ni contactos sin enmascarar.';

-- ============================================================
-- Catálogo de comunicaciones: 3 eventos nuevos para este flujo, reusando
-- communication_events/communication_templates (045_e6_communications.sql)
-- en vez de mensajes hardcodeados. El envío real (paso siguiente) usa
-- renderTemplate() sobre estas plantillas pero despacha con sendSms/sendEmail
-- directo -- NO con dispatchCommunication(), porque ese orquestador exige un
-- user_id con fila en profiles (comunicación con CLIENTES), y los
-- destinatarios aquí son trusted_successors, que no tienen cuenta de
-- usuario. Mismo precedente ya usado en
-- src/app/api/admin/backup-codes/verify/route.ts (alerta de seguridad por
-- sendEmail directo, fuera del orquestador por la misma razón).
-- ============================================================
INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('access_recovery_verification_code', 'Código de verificación para solicitud de recuperación de acceso', 'transactional', 'urgent', 'sms'),
  ('access_recovery_other_successor_alert', 'Alerta a los demás contactos de confianza: una recuperación de acceso fue verificada', 'transactional', 'urgent', 'sms'),
  ('access_recovery_emergency_code_issued', 'Código de acceso de emergencia emitido tras aprobación', 'transactional', 'urgent', 'sms')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, subject, body, is_current) VALUES
  ('access_recovery_verification_code', 'es', 1, NULL,
   'Lulu Island Flagship: alguien está solicitando recuperar el acceso del manager usando tu contacto de confianza. Motivo indicado: "{reason}". Si fuiste tú, tu código de verificación es {code} (vence en 15 minutos). Si NO fuiste tú, ignora este mensaje -- no compartas el código con nadie.',
   true),
  ('access_recovery_other_successor_alert', 'es', 1, NULL,
   'Lulu Island Flagship — aviso de seguridad: {successor_name} inició y verificó una solicitud de recuperación de acceso del manager (motivo: "{reason}"). Ningún acceso se otorgó todavía -- se requiere aprobación adicional. Si esto te parece sospechoso, contacta al equipo de inmediato.',
   true),
  ('access_recovery_emergency_code_issued', 'es', 1, NULL,
   'Lulu Island Flagship: tu solicitud de recuperación de acceso fue aprobada. Código de emergencia de un solo uso para que el manager entre: {code} (expira en 1 hora, un solo uso). Compárteselo de forma segura.',
   true)
ON CONFLICT (event_key, language, version) DO NOTHING;
