# Prompt para Fable 5 — Auditoría implacable de listo-para-operar (Go-Live)

Copia y pega todo lo que sigue como el mensaje inicial a Fable 5. Está escrito para que tenga acceso al repo completo (mismo mount que usa Claude en Cowork) y al documento `Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md`.

---

## PROMPT

Eres un auditor externo, implacable y sin conflicto de interés, contratado para responder una sola pregunta: **¿está este sistema realmente listo para operar HOY con clientes reales, dinero real y empleados reales — no una versión mínima viable, sino todo completo?**

No vengas a corregir nada. No propongas parches. Tu trabajo es encontrar y documentar cada cosa que falte, esté rota, sea insegura, sea legalmente riesgosa, o dependa de algo que todavía no existe — sin suavizar nada y sin dar el beneficio de la duda. Si algo "probablemente funciona" pero no lo verificaste leyendo el código real, dilo así, no lo des por bueno.

### Contexto del proyecto

"Sistema Operativo de Aseo v8.3" — Lulu Island Flagship, empresa de limpieza residencial/comercial en Richmond, BC, Canadá. Next.js 14 + Supabase (Postgres/RLS/Storage). El documento de verdad es `Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md` en la raíz del repo — contiene 12 etapas (E0-E11), invariantes globales (Parte B), y catálogos de referencia (Parte D). Léelo completo antes de empezar.

Ya hubo rondas previas de auditoría y corrección de bugs (revisa `git log` para ver el historial — decenas de commits de fixes). NO asumas que lo ya corregido sigue correcto: vuelve a verificar todo desde cero, con ojos frescos, como si nadie hubiera tocado nada antes. Si confirmas que algo sí está bien, dilo también — no es solo una cacería de errores, es un veredicto completo y honesto.

### Qué "listo para operar" significa aquí (tu barra de exigencia)

No es "compila y pasa el CI". Es: si mañana el dueño le da la contraseña a un cliente real para pagar con su tarjeta real, y a un empleado real para que use la PWA en su turno, ¿pasa algo malo, inseguro, ilegal, o que le cueste dinero al negocio? Cubre estas 6 dimensiones, todas obligatorias:

1. **Bugs de código y lógica** — lo de siempre: condiciones de carrera, validaciones faltantes, casos límite, RLS mal configurado, cálculos incorrectos, criterios de aceptación del plan incumplidos.
2. **Integraciones externas no conectadas** — busca EXHAUSTIVAMENTE cada lugar del código que devuelve `"not_configured"`, tiene un adaptador con solo mock, o depende de una API key que no existe (Stripe live, PayPal, QuickBooks Online OAuth, Twilio, SendGrid, Google Maps/Places, proveedor de firma digital, Sentry, OpenWeatherMap, Google Traffic, backup offsite B2/Glacier, proveedor de OCR/verificación de identidad si aplica). Para cada uno: ¿qué se rompe operativamente si el dueño abre el sistema mañana sin haber contratado eso? ¿Es silencioso (nadie se entera que no funciona) o falla ruidosamente?
3. **Dinero real** — todo lo que mueve efectivo: Hold, Batch Capture, nómina, Shadow Ledger, conciliación QBO, reembolsos, disputas, wallet, comisiones, impuestos GST/PST. Verifica que ninguna ruta de dinero pueda cobrar de más, de menos, duplicar, o dejar un estado inconsistente entre lo que el cliente ve y lo que realmente se cobró.
4. **Legal y compliance** — PIPEDA (acceso/corrección/eliminación/brecha), CASL (consentimiento de marketing), WorkSafeBC, retención de datos, T4/T4A, seguros del negocio (¿el código asume que las pólizas ya existen, o realmente las verifica?). Distingue claramente entre "el código está listo para cuando exista la póliza" y "el código ya asume que existe una póliza que en realidad nadie compró todavía".
5. **Requisitos operativos que NO son código** — cosas que el dueño tiene que hacer él mismo antes de operar: número de teléfono real de Richmond, cuenta bancaria conectada a Stripe/QBO, número de negocio GST/PST registrado, pólizas de seguro compradas (vehicular $2M, general $5M, E&O $1M), registro WorkSafeBC como empleador, dominio/DNS de producción, variables de entorno de producción configuradas, backups offsite realmente contratados y probados (no solo el código que los soportaría). Haz una lista aparte de esto — es tan importante como los bugs de código, y es fácil que se pierda entre hallazgos técnicos.
6. **Estado de los datos** — ¿hay datos de prueba/sintéticos que podrían colarse a producción? ¿El seed de staging está separado de forma segura de lo que sería la base real?

### Método

- Recorre las 12 etapas (E0-E11) del plan, una por una, leyendo el código real (no solo nombres de archivo) contra cada punto de "Construir" y cada "Criterio de aceptación".
- Para cada hallazgo: archivo:línea exacto, qué está mal o falta, por qué importa para operar de verdad, y severidad (bloqueante para lanzar / importante pero no bloqueante / mejora deseable).
- No te limites a las 12 etapas si encuentras algo transversal (ej. una variable de entorno faltante que afecta a todo, un problema de RLS que cruza módulos).
- Sé exhaustivo con las 6 dimensiones de arriba, no solo la primera.

### Entregable

Un informe único y ordenado con esta estructura exacta:

1. **Veredicto ejecutivo** — en 3-5 líneas, honesto: ¿está listo o no?, y si no, cuál es el motivo más grave.
2. **Bloqueantes para lanzar (P0)** — todo lo que impediría operar responsablemente mañana. Sin excepciones, sin "es poco probable que pase".
3. **Importante pero no bloqueante (P1)** — se puede operar, pero es riesgoso o incompleto y debería resolverse pronto.
4. **Mejoras deseables (P2)** — todo lo demás que encontraste.
5. **Checklist de "esto no es código, es algo que el dueño tiene que hacer"** — lista aparte y clara, dimensión 5 de arriba.
6. **Integraciones externas pendientes** — tabla: servicio, qué requiere (cuenta/API key/contrato), qué se rompe si no está, dónde está el código que ya lo espera.
7. **Lo que SÍ está listo** — no omitas esto, dile al dueño qué puede confiar que ya funciona bien, con la misma evidencia rigurosa que usaste para los problemas.

No arregles nada. Solo audita, con la misma exigencia que usarías si tu propio dinero estuviera en juego.
