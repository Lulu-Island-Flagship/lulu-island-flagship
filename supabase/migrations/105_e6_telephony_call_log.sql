-- Migración 105 — v8.3 E6.2: registro mínimo de llamadas de telefonía
-- semántica, para medir la meta del plan ("~80% de llamadas sin humano").
--
-- Alcance real: esto NO es un dashboard ni un sistema de reportes — es la
-- tabla mínima para que el dueño pueda correr un SELECT y calcular el
-- porcentaje de llamadas resueltas sin humano vs escaladas, y por qué. La
-- lógica que decide route/reason vive en src/lib/telephony-router.ts
-- (decideCallRouting, pura y testeada); esta tabla solo registra su salida.
--
-- PIPA: el teléfono del que llama nunca se guarda completo, mismo patrón
-- que communication_log/sms.ts (maskPhoneNumber) — solo los últimos 4
-- dígitos enmascarados.

CREATE TABLE IF NOT EXISTS telephony_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Número enmascarado del que llama (ej. "***1234"), nunca el completo.
  caller_phone_masked TEXT NOT NULL,

  -- Orden que matchCallerToSchedule encontró para esta llamada, si hubo.
  -- NULL cuando no hubo match (matched: false en CallerMatchResult).
  matched_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Resultado de decideCallRouting: si la llamada se resolvió sin persona
  -- ('self_service') o se escaló a un agente humano ('human').
  route TEXT NOT NULL CHECK (route IN ('self_service', 'human')),

  -- Motivo de la decisión (CallRoutingDecision.reason): 'anger_detected',
  -- 'no_matching_order_today', 'invalid_caller_phone', o el mensaje
  -- "Clasificado y resuelto sin humano (status: ...)" para self_service.
  reason TEXT NOT NULL,

  -- Si detectAngerSignal disparó el bypass inmediato a humano.
  anger_detected BOOLEAN NOT NULL DEFAULT false,

  -- Idioma en el que se respondió (idioma de la cuenta, o el fallback del
  -- número troncal si no hubo match).
  language TEXT NOT NULL CHECK (language IN ('en', 'es', 'zh')),

  -- Mensaje final que se le habló/leyó al cliente (InformResponse.message),
  -- para auditar que nunca se envió un placeholder roto o vacío.
  response_message TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telephony_call_log_route ON telephony_call_log(route);
CREATE INDEX IF NOT EXISTS idx_telephony_call_log_created_at ON telephony_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_telephony_call_log_matched_order ON telephony_call_log(matched_order_id);

COMMENT ON TABLE telephony_call_log IS
  'v8.3 E6.2: un registro por llamada entrante procesada por la telefonía '
  'semántica. Permite calcular route=self_service / total como medida real '
  'de la meta "~80% de llamadas sin humano" del plan. No es un dashboard; '
  'es la fuente mínima de datos para construir uno más adelante.';

ALTER TABLE telephony_call_log ENABLE ROW LEVEL SECURITY;

-- Solo admins/supervisores pueden leer el log de llamadas (contiene
-- contexto operativo, no datos que el cliente final deba ver).
CREATE POLICY "Supervisors read telephony call log" ON telephony_call_log
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Las escrituras las hace el webhook con la service role key (server-side),
-- nunca directamente desde un cliente autenticado con anon key.
