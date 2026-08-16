# Protocolo break-glass (Manifiesto v5.0, Parte 5.4)

El break-glass es el **conducto auditable de emergencia**: permite desbloquear
acotadamente una vía normal (p. ej. una escritura admin bloqueada por RLS o un
flujo financiero detenido) cuando un **SEV-0** impide seguir el procedimiento
ordinario. **Nunca debilita la segregación de privilegios**: no elimina reglas
ni cambia ownership; solo abre una vía temporal, acotada, registrada y que
expira sola.

## Reglas del protocolo

1. **Activación por M/N firmas de on-call.** La instancia define su umbral M/N
   (p. ej. 2/2). Para un equipo de una persona se acepta **contrafirma diferida
   documentada** (firma del on-call ahora + contrafirma de un aprobador
   externo/revisor dentro del incidente, registrada en el asiento) o la firma
   de un **aprobador externo**.
2. **Evento INMUTABLE.** Cada activación se registra como un **asiento** en
   `log.yaml`, que es **append-only**: una entrada escrita **nunca se edita ni
   se borra**. Las correcciones se hacen con un asiento posterior.
3. **TTL máximo 24 h.** `ttl_horas` no puede superar 24. Al alcanzar
   `expira_en`, los privilegios concedidos se **revocan automáticamente** (el
   gate de `verify:invariants` verifica que no hay activaciones activas
   expiradas).
4. **Alerta P0 a toda la organización.** Toda activación dispara una alerta P0
   (canal de incidentes de la instancia); el asiento lleva `alerta_p0: true` y
   se notifica el id de activación y el alcance concedido.
5. **Incident-to-test.** Antes de cerrar el incidente es **obligatorio** un
   test de regresión que reproduzca el fallo que obligó a abrir la vía
   (`incident_to_test`); sin ese enlace no se puede dar el incidente por
   cerrado.
6. **Segregación intacta.** El break-glass es un conducto auditable, no una
   excepción: no convierte a nadie en admin permanente, no modifica `rules.yaml`
   y toda concesión muere con el TTL.

## Flujo paso a paso

1. **Detectar SEV-0.** La vía normal está bloqueada y esperar el proceso
   ordinario agrava el incidente.
2. **Elegir el asiento.** Copiar `break-glass-template.yaml` y rellenar todos
   los campos: `activacion_id` (`BG-<fecha>-<secuencia>`), `motivo` (SEV-0),
   `firmas` (M/N), `contrafirma_diferida` si aplica, `privilegios` **acotados a
   lo imprescindible**, `activado_en` (ISO 8601), `ttl_horas` (≤ 24),
   `expira_en` (ISO 8601), `alerta_p0: true` e `incident_to_test`.
3. **Firmar.** Reunir las M firmas de on-call (o firma + contrafirma diferida /
   aprobador externo en equipo de una persona).
4. **Añadir a `log.yaml`.** Insertar el asiento **al final** del array
   `activaciones`. **Solo append**: no tocar entradas previas.
5. **Disparar P0.** Notificar a toda la organización con el id de activación,
   el motivo, los privilegios concedidos y la hora de expiración.
6. **Operar dentro del alcance.** Usar únicamente los privilegios listados y
   solo mientras el asiento esté vigente.
7. **Revocación automática.** Al llegar `expira_en` (máx. 24 h desde
   `activado_en`) los privilegios se revocan; el asiento permanece en el log
   para auditoría.
8. **Incident-to-test antes de cerrar.** Escribir y ejecutar el test de
   regresión que reproduce el fallo original; consignar su enlace en
   `incident_to_test` y verificar que la vía normal vuelve a funcionar.
9. **Post-mortem.** Si el break-glass reveló una regla demasiado estricta o un
   hueco, corregirlo por el proceso normal (CHANGE + waivers, Manifiesto
   v5.0 Partes 5.1/5.2 y 6.2) — nunca "normalizando" el break-glass.

## Auditoría

`log.yaml` es la fuente de verdad del evento. Cualquier activación debe poder
reconstruirse solo con el log: quién firmó, qué se desbloqueó, cuándo expiró y
qué test de regresión lo cerró. Una entrada editada invalida el evento; las
enmiendas se registran como asientos nuevos.

## Simulacro (drill)

El protocolo se ejercita con **tabletop drills** para detectar huecos sin
contaminar el log real. El **primer simulacro** se documenta en
[`docs/break-glass-drill.md`](../../docs/break-glass-drill.md)
(2026-08-15) y dejó una lección registrada como `@incident LEARNING-005`:

- El gate de `verify:invariants` debe validar el **TTL real derivado**
  (`expira_en == activado_en + ttl_horas` y `ttl_horas <= 24`), no solo el
  campo `ttl_horas` declarado. Un asiento con `ttl_horas: 24` pero
  `expira_en` lejano queda **rechazado**.
- Regla derivada tras el drill: el gate rechaza cualquier asiento con
  `expira_en != activado_en + ttl_horas`, con `ttl_horas > 24`, o activo con
  `expira_en < now` sin `revocado_en`.

En un drill **no** se escribe en el `log.yaml` real: el asiento de ejemplo se
ejercita con un fixture de test.
