# Documentación del proyecto — convención de carpetas

Esta carpeta contiene toda la documentación no-código del proyecto (auditorías, planes de construcción, runbooks). Dos subcarpetas, sin anidar por versión:

- **`vigente/`** — lo que hoy es verdad. Si querés entender el estado actual del proyecto o de una auditoría, empezá y quedate acá. Nada de lo que hay en `vigente/` está superado.
- **`historico/`** — todo lo que en algún momento fue `vigente/` y dejó de serlo. Se conserva completo (nunca se edita ni se borra) por trazabilidad, pero **no usar para diagnosticar el estado actual** — puede describir código, decisiones o hallazgos que ya cambiaron.

## Regla para mover un archivo de `vigente/` a `historico/`

Cuando un documento nuevo reemplaza a uno de `vigente/` (por ejemplo, una auditoría nueva que reemplaza a la anterior), el archivo viejo se mueve tal cual a `historico/` — mismo nombre, mismo contenido, sin subcarpetas nuevas ni reglas especiales — y se agrega una fila a la tabla de abajo. No hace falta crear una carpeta por versión (`v8.4/`, `v8.5/`, etc.): todo lo superado vive junto en `historico/`, ordenado por la tabla de abajo, no por estructura de carpetas.

## Índice de `historico/` — qué es cada cosa y qué lo reemplazó

| Archivo | Qué era | Reemplazado por |
|---|---|---|
| `v8.2_CONSOLIDADO_COMPLETO.md` | Documento consolidado completo de la versión v8.2 del proyecto (anterior a v8.3) | `vigente/v8.3_PLAN_DE_CONSTRUCCION.md` |
| `REPORTE_E1.md` | Checkpoint de auditoría de la etapa E1 (8 jul 2026) | Superado por rondas de auditoría posteriores; ver `vigente/` para el estado actual |
| `REPORTE_E2_E5.md` | Checkpoint de auditoría de las etapas E2–E5 (8 jul 2026) | Ídem |
| `REPORTE_E4_E5.md` | Checkpoint de auditoría de las etapas E4–E5 (8 jul 2026) | Ídem |
| `REPORTE_E4_SESION_13JUL.md` | Checkpoint de auditoría, sesión del 13 jul 2026 | Ídem |
| `INFORME_GO_LIVE_FABLE5.md` | Auditoría de go-live completa (19 jul 2026, pase anterior) | `vigente/INFORME_AUDITORIA_GO_LIVE_2026-07-20.md` (misma clase de informe, pase más reciente) |
| `PROMPT_AUDITORIA_FABLE5.md` | Prompt/instrucciones usadas para generar el informe FABLE5 | Ídem (documento de apoyo del mismo pase superado) |
| `PROMPT_AUDITORIA_FABLE5_GO_LIVE.md` | Prompt/instrucciones (variante go-live) del mismo pase FABLE5 | Ídem |
| `etapa_audit_inventory.md` | Plantilla/inventario de planificación para auditorías por etapa (11 jul 2026) | Proceso de auditoría ya no usa esta plantilla; ver `vigente/` para el formato actual de informes |
| `etapa_audit_prompt_template.md` | Plantilla de prompt para auditorías por etapa (11 jul 2026) | Ídem |
| `flow_audit_inventory.md` | Plantilla/inventario de planificación para auditorías por flujo (11 jul 2026) | Ídem |
| `flow_audit_prompt_template.md` | Plantilla de prompt para auditorías por flujo (11 jul 2026) | Ídem |
| `gemini_audit_prompt.md` | Prompt de auditoría preparado para otro modelo (Gemini), nunca reemplazó al proceso actual | Ídem |

## Qué hay en `vigente/` ahora mismo

| Archivo | Qué es |
|---|---|
| `v8.3_PLAN_DE_CONSTRUCCION.md` | Plan de construcción vigente de la versión v8.3 — el documento de referencia del proyecto |
| `INFORME_AUDITORIA_GO_LIVE_2026-07-20.md` | Primera auditoría de go-live del 20 jul 2026 (login/signup de los 3 tipos de usuario, más 4 bloqueadores/6 graves/6 medios ya resueltos el mismo día — ver anexo "§8. Resolución" al final del propio archivo) |
| `INFORME_AUDITORIA_IMPLACABLE_2026-07-20b.md` | Segunda auditoría (mismo día), independiente de la primera — encontró y describe 3 bloqueadores/4 graves/9 medios/5 menores adicionales, ya remediados (ver historial de commits `7e3d6b4` y `9f26c7d`) |
| `RUNBOOK_FLAGS_GO_LIVE.md` | Runbook operativo de feature flags para el go-live |

## Nota sobre `supabase/migrations/`

Las migraciones de base de datos **no siguen esta convención** y nunca deben moverse, renombrarse ni reorganizarse — Supabase rastrea qué migraciones ya se aplicaron en cada entorno por su nombre de archivo exacto. Una migración vieja no es "histórico" en el sentido de este documento: sigue siendo parte activa del esquema hasta el día que se decida una migración de deprecación explícita (borrar una tabla, angostar una columna, etc.), nunca por reorganización de carpetas.
