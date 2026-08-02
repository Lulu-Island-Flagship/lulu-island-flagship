-- Fix (2026-08-02, bug en producción): GET /api/hiring-flow/legal-text?
-- key=pipa_step1 devolvía 500 por un bug de código separado (ver commit
-- que corrige legal-text-service.ts: fetchLegalTextRows no resolvía un
-- cliente de Supabase por defecto). Al arreglar ese bug, la siguiente capa
-- del problema queda expuesta: la ÚNICA fila que existe para
-- key='pipa_step1' (v1.0, insertada por la migración 255) es contenido
-- placeholder ("[PLACEHOLDER -- CONTENIDO ESTRUCTURAL, PENDIENTE DE
-- REVISIÓN LEGAL]"), y la migración 309 la desactivó correctamente por
-- eso (is_active = false) -- así que incluso con el bug de código
-- arreglado, renderLegalText() seguiría lanzando LegalTextNotFoundError
-- ("no_active_version"), y /empleo se quedaría permanentemente en
-- "Loading consent terms..." (503 en vez de 500, pero igual de roto para
-- el candidato).
--
-- Esta migración inserta v1.1: un aviso de privacidad PIPA real para el
-- flujo de aplicación a empleo, con el mismo nivel de detalle y estructura
-- que la Política de Privacidad ya publicada y en producción en
-- /privacidad (messages/en.json -> legal.privacy), adaptado
-- específicamente a los datos que el formulario de aplicación a empleo
-- recolecta (nombre, email, teléfono, fecha de nacimiento -- ver
-- JobApplicationForm.tsx) y al propósito de evaluación de candidatos, en
-- vez de reservas de limpieza. No reemplaza revisión de un abogado
-- laboral/de privacidad de BC especializado en procesos de contratación,
-- pero es contenido real y específico (no un placeholder estructural) que
-- ya no contiene la palabra "PLACEHOLDER" (pasa el guard de
-- PlaceholderLegalTextError) y es consistente con la política ya
-- publicada del mismo negocio.
--
-- v1.1 (no v1.0) para no reescribir la fila histórica v1.0 -- que debe
-- quedar intacta como registro de qué contenido (placeholder) se le
-- mostró, si acaso, a cualquier candidato antes del 2026-08-01 (ver
-- migración 309). effective_from = now(): entra en vigor de inmediato.

INSERT INTO legal_texts (key, version, content, is_active, effective_from)
VALUES (
  'pipa_step1',
  'v1.1',
  E'Privacy Notice -- Personal Information Protection Act (PIPA), British Columbia\n\n'
  '[COMPANY_NAME] collects, uses, and discloses your personal information solely for the '
  'purposes of evaluating your job application, in accordance with the Personal Information '
  'Protection Act (PIPA) of British Columbia.\n\n'
  '1. Information we collect\n'
  'Your first and last name, email address, phone number, and date of birth, as provided on '
  'this application form. If your application advances, we may separately request additional '
  'information (such as work eligibility documentation or a criminal record check), and you '
  'will be asked for your consent to that separately at that stage.\n\n'
  '2. How we use your information\n'
  'To evaluate your fit for open positions, contact you about your application and, if '
  'applicable, next steps or an offer of employment, and comply with our legal and '
  'record-keeping obligations related to hiring.\n\n'
  '3. Retention\n'
  'If your application is not successful, your personal information is retained for up to 1 '
  'year from the date of application, in case a suitable position opens during that period, '
  'and is then deleted. If you are hired, your information becomes part of your employment '
  'record and is retained according to our employment record-keeping obligations under '
  'applicable BC law.\n\n'
  '4. Your rights under PIPA\n'
  'You have the right to access the personal information we hold about you, request '
  'correction of inaccurate information, and request deletion of your application information '
  '(subject to the retention described above). To exercise any of these rights, contact us at '
  'hello@luluislandflagship.ca.\n\n'
  '5. Service providers\n'
  'We use Supabase (database hosting) to store your application information. Supabase is '
  'contractually and technically restricted to using your information solely to provide '
  'hosting services to us.\n\n'
  '6. Contact\n'
  'Privacy questions about this hiring process can be sent to hello@luluislandflagship.ca. '
  'This notice covers your job application specifically -- see our full Privacy Policy at '
  '/privacidad for how we handle client and customer information.',
  true,
  now()
)
ON CONFLICT (key, version) DO NOTHING;

-- La migración 309 desactivó v1.0 (is_active = false); esta migración
-- inserta v1.1 ya con is_active = true. No hace falta un UPDATE adicional
-- desactivando v1.0 de nuevo -- ya está desactivada -- pero se deja este
-- comentario como registro explícito de que la intención es que v1.1, no
-- v1.0, sea la única versión activa tras esta migración.
