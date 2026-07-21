-- ============================================================
-- v8.3 fix G-6 (auditoría staff/admin login) — plantilla 'fr' faltante para
-- el evento 'employee_invited'.
--
-- Contexto: la migración 202 (202_e0_staff_portal_employee_invitation.sql)
-- insertó plantillas para 'en', 'es' y 'zh', pero src/i18n/config.ts declara
-- locales = ['en', 'zh', 'fr'] -- NO incluye 'es', y SÍ incluye 'fr'. La
-- función sendEmployeeInvitation() (src/app/api/admin/empleados/[id]/route.ts)
-- elegía idioma con la lista vieja (["en","es","zh"]), así que un empleado
-- cuyo `languages` fuera solo ['fr'] (un valor legítimo de locale en este
-- proyecto) nunca podía matchear "es" (idioma inexistente para el resto de
-- la app) y caía siempre a "en" por default -- y aunque se corrija esa lista
-- en el código, sin esta plantilla 'fr' el lookup de communication_templates
-- seguiría sin encontrar nada y el envío quedaría en skipped_no_template.
--
-- La plantilla 'es' de la migración 202 queda huérfana (ningún locale de la
-- app usa 'es') pero NO se toca aquí -- migración ya aplicada, y borrar una
-- fila de una migración previa está fuera de alcance de este fix. Se puede
-- limpiar en una migración de deprecación separada si se decide remover
-- soporte a 'es' de communication_templates por completo.
-- ============================================================

INSERT INTO communication_templates (event_key, language, version, subject, body) VALUES
  ('employee_invited', 'fr', 1,
    'Bienvenue dans l''équipe, {employee_name}!',
    'Bonjour {employee_name}, votre compte est maintenant actif. Connectez-vous au Portail d''équipe à {portal_url} avec le même compte Google enregistré ({employee_email}) pour voir votre horaire et commencer.')
ON CONFLICT (event_key, language, version) DO NOTHING;
