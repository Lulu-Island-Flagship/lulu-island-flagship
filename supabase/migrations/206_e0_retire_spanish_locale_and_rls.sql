-- ============================================================
-- v8.3 fix B-1 / B-3 / m-3 (auditoría implacable 2026-07-20b):
--
-- B-3: la app tiene dos listas de idiomas contradictorias. src/i18n/config.ts
-- (locales = ['en', 'zh', 'fr'], con messages/en.json, fr.json, zh.json de
-- 62 claves cada uno) es lo que de verdad maneja routing/mensajes. Pero
-- src/lib/languages.ts (SUPPORTED_LANGUAGES) y estos dos CHECK de abajo
-- declaraban en/zh/es -- 'es' nunca fue un locale real de la app (no hay
-- ruta /es, no hay messages/es.json), era un resto de un borrador anterior.
-- Decisión: estandarizar en/zh/fr en toda la app (Canadá: inglés/francés
-- oficiales + chino para el mercado de BC). src/lib/languages.ts ya se
-- corrigió en el mismo commit que esta migración.
--
-- B-1: 205_e0_employee_invited_fr_template.sql inserta un row con
-- language='fr' para communication_templates, pero el CHECK de la migración
-- 045 (communication_templates_language_check) solo permitía ('en','zh','es')
-- -- ese INSERT falla en una base de datos recién construida. Mismo problema
-- en telephony_call_log_language_check (migración 105).
--
-- m-3: la plantilla 'es' de 'employee_invited' (migración 202) quedaba
-- huérfana -- ningún locale de la app la usa. Se resuelve aquí junto con
-- TODAS las demás plantillas 'es' del catálogo (no solo employee_invited --
-- se auditó el archivo completo de migraciones y hay 18 event_keys más con
-- filas 'es', listadas abajo), traduciéndolas a francés en vez de dejarlas
-- huérfanas o simplemente borrarlas.
--
-- Estrategia de datos (obligatoria antes de angostar el CHECK -- un CHECK
-- constraint no distingue is_current/deleted_at, así que con is_current=false
-- NO alcanza: mientras la columna `language` siga conteniendo el string
-- 'es' en cualquier fila, ADD CONSTRAINT ... CHECK (language IN (...))
-- sin 'es' fallará su validación al crearse):
--   (a) Para 18 de los 19 event_keys con fila 'es': se convierte la fila
--       existente EN SITIO (UPDATE language='fr' + subject/body traducidos),
--       preservando version/is_current tal cual estaban. No son huérfanas
--       ni se pierden -- pasan a ser la plantilla francesa vigente.
--   (b) Para 'employee_invited': la migración 205 YA insertó una fila
--       ('employee_invited','fr',1,...) con traducción francesa propia.
--       Convertir la fila 'es' a language='fr' con version=1 chocaría con
--       esa UNIQUE (event_key, language, version). Se convierte en su lugar
--       a version=0 (superseded) + is_current=false, preservando el texto
--       histórico (traducido) sin colisionar con la fila vigente de 205.
--
-- NOTA DE TRADUCCIÓN: las traducciones francesas de esta migración son
-- correctas y completas en cuanto a significado, pero no pasaron por
-- revisión de un hablante nativo profesional -- igual que la nota que ya
-- traía 205_e0_employee_invited_fr_template.sql. Recomendado: que alguien
-- del equipo (o un traductor profesional) las revise antes de que el
-- volumen de clientes francófonos sea alto.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Convertir en sitio las plantillas 'es' -> 'fr' (communication_templates)
-- ------------------------------------------------------------

-- 159_e5_referrals_lulu_ambassador.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonne nouvelle, {client_name} ! Nous avons ajouté 30 $ à votre Lulu Wallet — la personne que vous avez recommandée vient de terminer son premier service. Merci de parler de nous autour de vous !'
WHERE event_key = 'referral_credited' AND language = 'es' AND version = 1;

-- 163_e10_nps_survey.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, sur une échelle de 0 à 10, quelle est la probabilité que vous recommandiez Lulu Island Flagship à un ami ou un collègue ? {survey_link}'
WHERE event_key = 'nps_quarterly_survey' AND language = 'es' AND version = 1;

-- 158_e5_rebook_frictionless.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Joyeux anniversaire, {client_name} ! Nous avons ajouté ${gift_amount} à votre Lulu Wallet en cadeau. Merci de faire partie de Lulu Island.'
WHERE event_key = 'birthday_gift' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  body = 'Ravis que vous ayez aimé votre service, {client_name} ! Si {leader_name} a fait votre journée, parlez-en à un ami — le bouche-à-oreille compte énormément pour notre équipe : {referral_link}'
WHERE event_key = 'leader_recommendation_reminder' AND language = 'es' AND version = 1;

-- 179_e2_contract_ipc_notification.sql
UPDATE communication_templates SET
  language = 'fr',
  subject = 'Le prix de votre service Lulu Island sera ajusté dans 30 jours',
  body = 'Bonjour {client_name}, dans le cadre de votre entente de service récurrent, votre prix sera ajusté de {ipc_percentage} % le {anniversary_date} (ajustement annuel au coût de la vie). Votre nouveau total sera de ${new_total} par visite. Aucune action n''est requise — ceci est simplement un avis. Des questions ? Répondez à ce courriel en tout temps.'
WHERE event_key = 'contract_ipc_notice' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  subject = 'Votre prix Lulu Island a été mis à jour',
  body = 'Bonjour {client_name}, comme annoncé précédemment, le prix de votre service récurrent a été ajusté à ${new_total} par visite, à compter d''aujourd''hui. Merci d''être un client fidèle de Lulu Island.'
WHERE event_key = 'contract_ipc_adjusted' AND language = 'es' AND version = 1;

-- 186_e10_seasonal_campaign_dispatch_event.sql
UPDATE communication_templates SET
  language = 'fr',
  subject = 'Lulu Island Flagship — {campaign_name}',
  body = 'Bonjour {client_name}, c''est la saison {campaign_name} chez Lulu Island. Réservez votre prochain service : {booking_link}'
WHERE event_key = 'seasonal_campaign_dispatch' AND language = 'es' AND version = 1;

-- 146_e10_churn_signals.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, vous nous manquez dans notre agenda. Un sondage rapide de 30 secondes (avec un crédit de 20 $ pour votre temps) nous aide à comprendre ce qui a changé : {survey_link}'
WHERE event_key = 'churn_survey_recurring_60d' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, cela fait un moment — revenez avec 30 % de rabais sur votre prochain service : {reactivation_link}'
WHERE event_key = 'churn_discount_sporadic_90d' AND language = 'es' AND version = 1;

-- 201_e6_non_tech_channel.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, votre nettoyage du {service_date} est terminé. Comme votre compte est configuré pour un accompagnement téléphonique, notre équipe vous appellera dans environ 2 heures pour tout passer en revue — aucune application nécessaire.'
WHERE event_key = 'no_smartphone_callback' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, ceci confirme votre nettoyage Lulu Island le {service_date} à {service_time}. [1=Oui] [2=Reporter] [3=Annuler]. (L''appel automatisé n''est pas encore connecté — suivez les instructions de réponse de notre équipe.)'
WHERE event_key = 'appointment_confirmation_24h' AND language = 'es' AND version = 1;

-- 181_e2_no_show_notice_template.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour, notre équipe est sur place mais n''a pas pu confirmer son arrivée. Répondez dans les 30 prochaines minutes pour reprogrammer, sinon nous devrons facturer les frais d''absence selon notre politique de réservation.'
WHERE event_key = 'no_show_notice' AND language = 'es' AND version = 1;

-- 185_e6_payment_failed_templates.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, nous n''avons pas pu traiter le paiement de la commande {order_id}. Veuillez mettre à jour votre méthode de paiement : {payment_link}'
WHERE event_key = 'payment_failed' AND language = 'es' AND version = 1;

-- 084_e6_dispute_resolved_event.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, une mise à jour concernant votre signalement pour le service du {service_date} : {resolution_summary}. Des questions ? Répondez simplement à ce message.'
WHERE event_key = 'dispute_resolved' AND language = 'es' AND version = 1;

-- 156_e5_pre_review_survey.sql
UPDATE communication_templates SET
  language = 'fr',
  body = 'Bonjour {client_name}, un rapide suivi de 30 secondes sur votre service du {service_date} (recevez 10 $ de crédit Lulu Wallet en répondant) : {survey_link}'
WHERE event_key = 'pre_review_survey' AND language = 'es' AND version = 1;

-- 203_e11_access_recovery_requests.sql (solo tenían fila 'es', sin 'en'/'zh')
UPDATE communication_templates SET
  language = 'fr',
  body = 'Lulu Island Flagship : quelqu''un demande à récupérer l''accès du gestionnaire en utilisant votre contact de confiance. Motif indiqué : « {reason} ». Si c''était vous, votre code de vérification est {code} (expire dans 15 minutes). Si ce n''était PAS vous, ignorez ce message — ne partagez ce code avec personne.'
WHERE event_key = 'access_recovery_verification_code' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  body = 'Lulu Island Flagship — avis de sécurité : {successor_name} a lancé et vérifié une demande de récupération d''accès du gestionnaire (motif : « {reason} »). Aucun accès n''a encore été accordé — une approbation supplémentaire est requise. Si cela vous semble suspect, contactez l''équipe immédiatement.'
WHERE event_key = 'access_recovery_other_successor_alert' AND language = 'es' AND version = 1;

UPDATE communication_templates SET
  language = 'fr',
  body = 'Lulu Island Flagship : votre demande de récupération d''accès a été approuvée. Code d''urgence à usage unique pour que le gestionnaire puisse se connecter : {code} (expire dans 1 heure, usage unique). Partagez-le de façon sécurisée.'
WHERE event_key = 'access_recovery_emergency_code_issued' AND language = 'es' AND version = 1;

-- 202_e0_staff_portal_employee_invitation.sql -- caso especial: 205 ya
-- insertó ('employee_invited','fr',1,...). Esta fila 'es' se convierte a
-- version=0 (superseded) + is_current=false para no chocar con la UNIQUE
-- (event_key, language, version) ni con el índice parcial de "vigente".
UPDATE communication_templates SET
  language = 'fr',
  version = 0,
  is_current = false,
  subject = 'Bienvenue dans l''équipe, {employee_name}! (v0, superseded)',
  body = 'Bonjour {employee_name}, votre compte est maintenant actif. Connectez-vous au Portail d''équipe à {portal_url} avec le même compte Google enregistré ({employee_email}) pour voir votre horaire et commencer. [Traducción histórica v0 -- reemplazada por la plantilla vigente de la migración 205_e0_employee_invited_fr_template.sql.]'
WHERE event_key = 'employee_invited' AND language = 'es' AND version = 1;

-- Salvaguarda: si por lo que sea quedara alguna fila 'es' no contemplada
-- arriba (no debería, se auditó todo supabase/migrations/*.sql y seed.sql),
-- se re-etiqueta como 'fr' (desactivada, sin traducción -- is_current=false
-- para que nunca se sirva sin traducir) en vez de dejarla con language='es',
-- porque is_current=false por sí solo NO alcanza para pasar el ADD
-- CONSTRAINT de abajo (el CHECK mira el valor de la columna `language` en
-- TODAS las filas, sin importar is_current/deleted_at).
UPDATE communication_templates SET language = 'fr', is_current = false
WHERE language = 'es';

-- Por las dudas, mismo tratamiento en telephony_call_log (no tiene seed de
-- datos hoy, pero por si un entorno ya generó filas en runtime con 'es').
-- No hay traducción posible aquí sin el contexto original de la llamada;
-- se preserva el dato tal cual, solo se re-etiqueta el idioma como 'en'
-- (fallback documentado del enrutador) para no perder el registro de
-- auditoría de la llamada.
UPDATE telephony_call_log SET language = 'en' WHERE language = 'es';

-- ------------------------------------------------------------
-- 2. Angostar los CHECK de idioma: en/zh/es -> en/zh/fr
-- ------------------------------------------------------------

ALTER TABLE communication_templates DROP CONSTRAINT IF EXISTS communication_templates_language_check;
ALTER TABLE communication_templates ADD CONSTRAINT communication_templates_language_check
  CHECK (language IN ('en', 'zh', 'fr'));

ALTER TABLE telephony_call_log DROP CONSTRAINT IF EXISTS telephony_call_log_language_check;
ALTER TABLE telephony_call_log ADD CONSTRAINT telephony_call_log_language_check
  CHECK (language IN ('en', 'zh', 'fr'));

-- ============================================================
-- v8.3 fix B-2 (auditoría implacable 2026-07-20b): 6 tablas sin RLS.
--
-- Verificado: grep -rhoE "ALTER TABLE ([a-z_]+) ENABLE ROW LEVEL SECURITY"
-- supabase/migrations/*.sql cubre 147 de 153 tablas. Las 6 que faltan son
-- todas de 142_e9_pipeda_legal_monitoring.sql -- tablas de compliance/legal
-- altamente sensibles (solicitudes de derechos PIPEDA, brechas de datos,
-- monitoreo legal dinámico). Mismo patrón que el resto del repo: función
-- SECURITY DEFINER is_supervisor(auth.uid()) (definida en
-- 126_e0_fix_search_path_hijack.sql), admin/supervisor-only, sin acceso de
-- cliente/anon. Ver telephony_call_log (105) y contract_reviews (168) como
-- referencia del mismo patrón. Las escrituras de estas 6 tablas las hacen
-- siempre endpoints server-side con la service role key (cron de monitoreo
-- legal, endpoints de admin de PIPEDA) -- igual que telephony_call_log --
-- así que basta con una policy de lectura+escritura para supervisores/admin,
-- sin policy separada de "solo lectura" para otro rol.
-- ============================================================

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage data subject requests" ON data_subject_requests;
CREATE POLICY "Supervisors manage data subject requests" ON data_subject_requests
  FOR ALL USING (is_supervisor(auth.uid()));

ALTER TABLE data_breach_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage data breach incidents" ON data_breach_incidents;
CREATE POLICY "Supervisors manage data breach incidents" ON data_breach_incidents
  FOR ALL USING (is_supervisor(auth.uid()));

ALTER TABLE legal_change_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage legal change alerts" ON legal_change_alerts;
CREATE POLICY "Supervisors manage legal change alerts" ON legal_change_alerts
  FOR ALL USING (is_supervisor(auth.uid()));

ALTER TABLE legal_monitoring_blind_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage legal monitoring blind alerts" ON legal_monitoring_blind_alerts;
CREATE POLICY "Supervisors manage legal monitoring blind alerts" ON legal_monitoring_blind_alerts
  FOR ALL USING (is_supervisor(auth.uid()));

ALTER TABLE legal_monitoring_feeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage legal monitoring feeds" ON legal_monitoring_feeds;
CREATE POLICY "Supervisors manage legal monitoring feeds" ON legal_monitoring_feeds
  FOR ALL USING (is_supervisor(auth.uid()));

ALTER TABLE legal_monitoring_quarterly_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews;
CREATE POLICY "Supervisors manage legal monitoring quarterly reviews" ON legal_monitoring_quarterly_reviews
  FOR ALL USING (is_supervisor(auth.uid()));
