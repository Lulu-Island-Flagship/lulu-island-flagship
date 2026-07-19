-- ============================================================
-- v8.3 — Portal de equipo unificado + activación de empleado con invitación
--
-- Contexto: el manager ya podía crear un empleado nuevo (is_active=false
-- hasta aprobación, ver POST /api/admin/empleados, FIX-10) pero no existía
-- ningún evento en el catálogo de comunicaciones (communication_events /
-- communication_templates, migración 045) para avisarle al empleado, cuando
-- el manager lo activa, que ya puede entrar al Portal de equipo. Mismo
-- patrón exacto que 084_e6_dispute_resolved_event.sql: INSERT del evento +
-- sus 3 plantillas por idioma, version=1, is_current=true por default.
--
-- default_channel='email' porque `employees` guarda el email directamente
-- (a diferencia de los eventos orientados a cliente, que usan `profiles`) --
-- ver src/app/api/admin/empleados/[id]/route.ts (PATCH con isActive=true),
-- que renderiza esta plantilla y llama a sendEmail() directo (mismo
-- adaptador que src/lib/send-communication.ts, sin pasar por
-- dispatchCommunication porque esa función asume destinatarios en
-- `profiles`, que no aplica a empleados).
-- ============================================================

INSERT INTO communication_events (event_key, description, category, priority, default_channel) VALUES
  ('employee_invited', 'Invitación al Portal de equipo cuando el manager activa a un empleado nuevo', 'transactional', 'normal', 'email')
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO communication_templates (event_key, language, version, subject, body) VALUES
  ('employee_invited', 'en', 1,
    'Welcome to the team, {employee_name}!',
    'Hi {employee_name}, your account is now active. Sign in to the Team Portal at {portal_url} using the same Google account we have on file ({employee_email}) to see your schedule and get started.'),
  ('employee_invited', 'es', 1,
    '¡Bienvenido/a al equipo, {employee_name}!',
    'Hola {employee_name}, tu cuenta ya está activa. Entra al Portal de equipo en {portal_url} con la misma cuenta de Google que tenemos registrada ({employee_email}) para ver tu horario y comenzar.'),
  ('employee_invited', 'zh', 1,
    '欢迎加入团队，{employee_name}！',
    '您好{employee_name}，您的账号现已激活。请使用我们登记的同一个 Google 账号（{employee_email}）登录团队门户 {portal_url}，查看您的排班并开始工作。')
ON CONFLICT (event_key, language, version) DO NOTHING;
