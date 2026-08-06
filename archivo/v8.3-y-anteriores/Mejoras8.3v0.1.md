# MEJORAS v8.3 — ANEXO ARQUITECTÓNICO v0.1
## Sistema Operativo de Aseo | Lulu Island Flagship

**Documento:** Mejoras8.3v0.1
**Fecha:** 4 de Agosto, 2026
**Jurisdicción:** British Columbia, Canadá
**Relación con v8.3:** Este documento es un anexo obligatorio. Todo lo aquí adoptado se integra al plan de construcción. Todo lo rechazado queda documentado para evitar reconsideración prematura.

---

# PARTE A: PRINCIPIOS DE ESTE ANEXO

1. **Realidad física sobre elegancia teórica.** Ninguna mejora se adopta si no resuelve un problema real de operación, legalidad o supervivencia del negocio.
2. **Sin infraestructura nueva hasta justificación por volumen.** Si una mejora requiere un servicio/motor/orquestador nuevo, se rechaza hasta que el volumen de operación (servicios/mes, equipos, clientes) la exija explícitamente.
3. **El dueño debe poder operar esto solo.** Si una mejora añade complejidad que requiere un devops dedicado, se diferencia o se simplifica.
4. **Este anexo se revisa trimestralmente** junto con el v8.3 (enero/abril/julio/octubre). Lo adoptado hoy puede rechazarse mañana si la realidad lo desmiente.

---

# PARTE B: MEJORAS ADOPTADAS

## B.1 Event Map — Catálogo de Eventos de Dominio (ADOPTADO)

**Estado:** Obligatorio en E0 antes de la primera migración de negocio.
**Razón:** El v8.3 menciona "Event Bus" pero no define los eventos. Sin un catálogo mínimo, cada desarrollador inventará sus nombres y el sistema se desacoplará en el sentido incorrecto (caos en lugar de orden).

### B.1.1 Lista canónica de eventos (MVP)

Todo evento lleva obligatoriamente: `event_id` (UUID v4), `aggregate_id` (UUID de la entidad raíz), `timestamp` (ISO 8601 con zona), `correlation_id` (UUID de traza), `version` (semver del schema), `payload` (JSON validado por Zod).

| Evento | Aggregate | Dispara | Consumidor(es) |
|--------|-----------|---------|----------------|
| `cuenta.creada` | `cuenta_cliente` | E1 | Comunicaciones (bienvenida), Analytics (CAC) |
| `cotizacion.generada` | `orden_servicio` | E1 | Analytics (funnel), Precios (snapshot de reglas) |
| `orden.reservada` | `orden_servicio` | E1 | Pagos (SetupIntent), Comunicaciones (confirmación), Despacho (bloqueo capacidad) |
| `precio.congelado` | `orden_servicio` | E1 | Audit (snapshot inmutable), Despacho (HHE sellada) |
| `hold.autorizado` | `transaccion` | E2 | Comunicaciones (recordatorio 24h), Audit |
| `hold.capturado` | `transaccion` | E2 | Shadow Ledger, Comunicaciones (recibo) |
| `hold.liberado` | `transaccion` | E2 | Shadow Ledger |
| `equipo.asignado` | `orden_servicio` | E3 | PWA (descarga SOP + ruta), Comunicaciones (ETA) |
| `jornada.iniciada` | `equipo` | E4 | GPS (trail activo), Audit |
| `zona.completada` | `orden_servicio` | E4 | Inventario (consumo real), QC (acumulación) |
| `servicio.completado` | `orden_servicio` | E4 | QC (muro), Comunicaciones (galería), Score (equipo) |
| `evidencia.subida` | `evidencia_foto` | E4 | QC (thumbnail), Almacenamiento (pipeline WebP) |
| `ticket.creado` | `ticket` | E5 | Batch Capture (exclusión condicional), Bandeja (priorización) |
| `ticket.resuelto` | `ticket` | E5 | Batch Capture (reinclusión si aplica), Comunicaciones |
| `batch.captura_ejecutada` | `nomina_ciclo` | E2 | Shadow Ledger, QBO (sync 2AM), Comunicaciones (recibo final) |
| `pago.fallido` | `transaccion` | E2 | Comunicaciones (SMS retry), Bandeja (alerta admin) |
| `nomina.calculada` | `nomina_ciclo` | E9 | Comunicaciones (desglose empleado), Audit |
| `regla.precio_cambiada` | `reglas_precio` | E1/E9 | Precios (recálculo tabla 20 celdas), Audit (snapshot) |
| `empleado.activado` | `empleado` | E0/E8 | Despacho (disponibilidad), Comunicaciones (bienvenida) |
| `excepcion.disparada` | `ticket` | E7 | Bandeja (timer 10 min), Workflow (fallback) |

### B.1.2 Schema mínimo de payload (Zod)

```typescript
// shared/events.ts — importado por TODOS los módulos
export const BaseEventSchema = z.object({
  event_id: z.string().uuid(),
  aggregate_id: z.string().uuid(),
  aggregate_type: z.enum([
    'cuenta_cliente', 'orden_servicio', 'empleado', 
    'equipo', 'transaccion', 'ticket', 'evidencia_foto'
  ]),
  timestamp: z.string().datetime(),
  correlation_id: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  payload: z.record(z.unknown()),
});

// Ejemplo: evento de dominio específico
export const OrdenReservadaEvent = BaseEventSchema.extend({
  event_type: z.literal('orden.reservada'),
  payload: z.object({
    orden_id: z.string().uuid(),
    cuenta_id: z.string().uuid(),
    precio_sellado: z.number().positive(),
    hhe: z.number().positive(),
    n_referencia: z.number().int().min(1).max(6),
    ft2: z.number().positive(),
    tipo_servicio: z.enum(['Regular', 'Deep', 'Move-in/out', 'Post-construccion']),
    zona_codigo_postal: z.string(),
    idiomas_requeridos: z.array(z.string()),
    snapshot_reglas: z.record(z.unknown()), // clon inmutable de reglas activas
  }),
});
```

### B.1.3 Implementación técnica

- **Event Store:** Tabla `event_log` en PostgreSQL (append-only, particionada mensualmente desde el mes 6 si >100K eventos/mes).
- **Publicación:** Edge Functions publican a `event_log` vía INSERT dentro de la misma transacción de negocio.
- **Consumo:** Bull jobs en Redis leen `event_log` con polling cada 5 segundos (suficiente para MVP; >300 servicios/mes → NATS según D.12).
- **Idempotencia:** Clave única compuesta `(event_id, consumer_name)` en tabla `event_consumer_checkpoint`.
- **Dead Letter:** Tras 5 reintentos con backoff exponencial, evento va a `event_dlq` con motivo, timestamp y payload completo. Alerta admin en bandeja unificada.

---

## B.2 Matriz de Ownership de Datos (ADOPTADO)

**Estado:** Obligatorio en E0. Ninguna migración de negocio se aprueba sin esta matriz firmada en el comentario de la migración.
**Razón:** El v8.3 menciona "propiedad de tabla por módulo" (C.3) pero no la detalla. Sin ownership explícito, múltiples módulos mutan la misma tabla y el sistema se vuelve imposible de debuggear.

### B.2.1 Reglas de ownership

1. **Solo el módulo dueño puede INSERT/UPDATE/DELETE en su tabla.** Los demás módulos consumen vía API interna o leen la proyección de lectura.
2. **Tablas de unión (many-to-many):** el módulo que crea la relación es dueño. Ej: `equipo_empleado` pertenece a `modulo_despacho`.
3. **Tablas de log/audit:** `audit_log` es dueño de `modulo_audit`. Cualquier módulo puede INSERT (append-only), nadie puede UPDATE/DELETE.
4. **Event Store:** `modulo_eventos` es dueño de `event_log`. Solo él escribe (vía trigger o API). Los demás leen via polling.

### B.2.2 Matriz completa

| Tabla | Módulo Dueño (Escritura) | Lectores Permitidos | Notas de frontera |
|-------|---------------------------|---------------------|-------------------|
| `cuenta_cliente` | `modulo_cliente` | Cotizador, Despacho, Pagos, Comunicaciones, QC | Score interno: solo `modulo_cliente` escribe. Invisible por contrato de API. |
| `perfil_propiedad` | `modulo_cliente` | Cotizador, Despacho, PWA, QC | Flags de riesgo: escritura por PWA (daño pre-existente) y Cliente (alta). |
| `empleado` | `modulo_rrhh` | Despacho, Nomina, PWA (lectura propia) | Day Rate, datos bancarios: solo Nomina lee vía API segregada. |
| `equipo` | `modulo_despacho` | PWA, Nomina, QC | Score del equipo: solo QC escribe (vía evento `servicio.completado`). |
| `orden_servicio` | `modulo_cotizador` (crea), `modulo_despacho` (asigna), `modulo_qc` (cierra) | Todos los módulos | Estado machine explícita. Transiciones validadas por trigger DB. |
| `zona_limpieza` | `modulo_sop` (admin) | Cotizador, Despacho, PWA | Edición requiere aprobación humano (B.3.6). Snapshot obligatorio. |
| `sop` | `modulo_sop` (admin) | PWA | Versión explícita. PWA descarga la versión vigente al inicio de jornada. |
| `reglas_precio` | `modulo_precios` | Cotizador (vía API), Audit | IF/THEN evaluado aquí. Cotizador nunca toca la tabla directamente. |
| `feature_flags` | `modulo_config` | Todos (lectura en bootstrap) | Solo Admin escribe. Cambio = snapshot + motivo. |
| `evento_comunicacion` | `modulo_comunicaciones` | Todos (vía API `Notification.Send()`) | Plantillas versionadas por idioma. |
| `ticket` | `modulo_qc` | Despacho, Pagos, Comunicaciones, Bandeja | Creación por QC, PWA, Cliente. Resolución solo QC/Admin. |
| `transaccion` | `modulo_pagos` | Contabilidad, Nomina, Audit | Shadow Ledger = fuente de verdad operativa. QBO es réplica. |
| `nomina_ciclo` | `modulo_nomina` | Contabilidad, Empleado (lectura propia), Audit | Ciclo quincenal. Datos bancarios desacoplados en tabla separada. |
| `inventario` | `modulo_inventario` | Despacho (verificación previa), PWA (consumo real), Admin (PO) | Conectado a SOP para consumo estimado. |
| `vehiculo` | `modulo_flota` | Despacho (asignación), Admin (mantenimiento) | Seguro vencido = bloqueo de asignación automático. |
| `punto_logistico` | `modulo_inventario` | PWA (checklist), Admin | Ciclo paño: limpio→usado→sucio→lavado→bodega→vehículo. |
| `evidencia_foto` | `modulo_evidencia` | QC, Cliente (galería), Admin (disputas) | Pipeline: PWA → WebP/EXIF → Storage → B2 tras 90 días. |
| `gps_log` | `modulo_ubicacion` | Despacho (trail), Admin (disputas) | TTL 30 días. Solo vehículo, nunca persona (B.2.17). |
| `audit_log` | `modulo_audit` | Admin (lectura), Compliance (exportación) | Append-only. Hash SHA-256 por entrada. Retención: 7 años (PIPEDA/CRA). |
| `event_log` | `modulo_eventos` | Todos (polling consumo), Admin (debug) | Particionamiento mensual desde mes 6. |
| `config_snapshot` | `modulo_config` | Admin (historial), Audit | Undo hasta 90 días. Motivo obligatorio. |
| `nota_operativa` | `modulo_cliente` / `modulo_despacho` (contextual) | Todos (lectura ligada a entidad) | Sugerida por contexto (ej: "asignar Equipo María → no con Pedro"). |

---

## B.3 Contratos de API Internos (ADOPTADO)

**Estado:** Obligatorio en E0. Convención de código, no documento separado bloqueante.
**Razón:** El v8.3 dice "contratos versionados" pero no define formato. Sin formato, no hay tests de contrato.

### B.3.1 Convención de rutas

```
/api/v1/{modulo}/{recurso}
```

Ejemplos:
- `POST /api/v1/cotizador/quote` — genera cotización
- `POST /api/v1/pagos/hold` — autoriza Hold
- `POST /api/v1/comunicaciones/notify` — envía notificación
- `GET /api/v1/despacho/capacidad?fecha=2026-08-10&zona=richmond-norte` — slots disponibles

### B.3.2 Schema validation

- **Input/Output:** Zod schemas compartidos en monorepo (`packages/schemas`).
- **Tests de contrato:** Cada Edge Function expone su schema; test automático valida que input/output cumplan antes de cada deploy.
- **Versionado:** Path-based (`/api/v1/`, `/api/v2/`). Breaking change = nueva versión. Deprecación: 90 días de aviso en headers.

### B.3.3 Ejemplo de contrato mínimo

```typescript
// packages/schemas/src/precios.ts
export const CotizarInput = z.object({
  ft2: z.number().positive().max(20000),
  tipo_servicio: z.enum(['Regular', 'Deep', 'Move-in/out', 'Post-construccion']),
  mascotas: z.object({ tipo: z.enum(['ninguna', 'corto', 'largo']), cantidad: z.number().int().min(0) }),
  residentes: z.number().int().min(1).max(20),
  dias_recencia: z.number().int().min(0),
  codigo_postal: z.string().regex(/^[A-Z]\d[A-Z] \d[A-Z]$/), // Formato canadiense
});

export const CotizarOutput = z.object({
  precio_base: z.number().positive(),
  recargos: z.array(z.object({ concepto: z.string(), monto: z.number() })),
  subtotal: z.number().positive(),
  impuestos: z.object({ gst: z.number(), pst: z.number() }),
  total: z.number().positive(),
  hold_estimado: z.number().positive(),
  margen_contribucion_proyectado: z.number(),
  alerta_margen: z.boolean(), // true si <15%
  snapshot_reglas: z.record(z.unknown()), // para sellado
});
```

---

## B.4 Sync Protocol Offline-First para PWA (ADOPTADO)

**Estado:** Obligatorio en E4 antes de la primera jornada de prueba.
**Razón:** El v8.3 dice "SQLite local, sync en background" pero no define resolución de conflictos. Sin protocolo, un SOP editado por admin a las 4 PM mientras el líder está offline genera caos operativo.

### B.4.1 Estrategia de conflictos

| Recurso | Fuente de verdad en conflicto | Comportamiento |
|---------|------------------------------|----------------|
| SOP (procedimiento) | Servidor (admin) | Servidor gana. PWA muestra banner "SOP actualizado" y permite re-ejecución. |
| Orden de servicio | Servidor (sistema) | Servidor gana. PWA re-descarga estado actual. |
| Fotos/evidencia | Cliente (PWA) | Cliente gana. Son datos generados en campo, irreproducibles. |
| Checklist/completados | Último escritor con timestamp | Timestamp mayor gana. Si diferencia >5 min, marca "revisar". |
| Consumo de inventario | Cliente (PWA) | Cliente gana. Es la realidad física. |

### B.4.2 Vector clock simplificado

Cada recurso sincronizable lleva:
- `version_local`: integer autoincremental de la PWA.
- `version_server`: integer autoincremental del servidor.
- `last_sync_at`: timestamp del último sync exitoso.

Al sincronizar:
1. PWA envía `version_local` del recurso.
2. Servidor compara con `version_server`.
3. Si `version_server > version_local`: servidor envía versión nueva. PWA aplica según tabla B.4.1.
4. Si `version_local > version_server`: PWA envía su versión. Servidor aplica y actualiza `version_server`.
5. Si iguales: nada que hacer.

### B.4.3 Fotos en background

- **Cola local:** IndexedDB con límite 50MB por jornada.
- **Upload:** Background Sync API (Service Worker). Solo en WiFi a menos que el líder fuerce 4G (toggle en PWA).
- **Retry:** Exponencial (5s, 15s, 45s, 2min, 5min). Tras 5 fallos: alerta en siguiente sync + banner rojo en PWA.
- **Garbage collection:** Fotos de órdenes cerradas >30 días se eliminan de SQLite local automáticamente.

---

## B.5 Pipeline de Evidencia Fotográfica (ADOPTADO)

**Estado:** Obligatorio en E0 (esquema) + E4 (implementación).
**Razón:** Fotos se mencionan en E4, E5, E2, E10, pero no hay un flujo unificado. Esto generará pérdida de evidencia en disputas.

### B.5.1 Flujo completo

```
PWA (captura WebP nativo)
    ↓
Edge Function `procesar_evidencia`
    ├── Validar: ¿pertenece a zona activa? ¿timestamp dentro de T_in/T_out?
    ├── Procesar: WebP 1920×1080 ≤2MB, thumbnail 300×300
    ├── Extraer EXIF (GPS, timestamp cámara) → guardar en DB
    ├── Eliminar EXIF en copia pública
    ├── Almacenar: Supabase Storage (bucket `evidencia-produccion`)
    └── Registrar: `evidencia_foto` con hash SHA-256
    ↓
Bucket estructurado: `orden_id/zona_id/timestamp.webp`
    ↓
Tras 90 días: job nocturno migra a Backblaze B2 (inmutable)
    ↓
Disputas: EXIF original recuperable desde B2
```

### B.5.2 Anonimización para Live Portfolio

- **Automática:** Difuminado de rostros (modelo ligero on-device o Edge Function con TensorFlow.js).
- **Manual:** Admin revisa y aprueba/rechaza de un toque.
- **Metadatos:** GPS redondeado a ciudad, EXIF eliminado, timestamp truncado a fecha.
- **Sin consentimiento:** Solo fotos de demo genéricas, nunca del cliente.

---

## B.6 Inventario Conectado al Despacho (ADOPTADO — BLOQUEANTE E3)

**Estado:** 🚨 Bloqueante para E3. No puede haber despacho sin verificación de implementos.
**Razón:** Docs 3 y 4 identificaron correctamente que `equipment_reservations` y `supplier_catalog` son tablas huérfanas. Si un equipo llega a campo sin desengrasante, el SOP falla, el tiempo se extiende, el margen muere.

### B.6.1 Conexión al despacho (E3)

Antes de asignar un equipo a una orden:
1. El sistema calcula consumo estimado desde SOP: `Σ(tarea.cantidad_producto × zonas_del_servicio)`.
2. Verifica stock disponible en `inventario` para ese equipo/vehículo.
3. Si stock < estimado + 20% buffer:
   - **Opción A:** Generar reposición urgente (PO automática) y retrasar asignación 2h.
   - **Opción B:** Asignar equipo alternativo con stock.
   - **Opción C:** Alerta admin con costo/beneficio de cada opción (fallback 10 min).

### B.6.2 Conexión a la PWA (E4)

Al cerrar zona en PWA:
- Líder confirma consumo real (default = estimado del SOP, editable con override).
- Acumulación diaria se synca al servidor.
- Desviación >20% consistente → sugerencia de ajuste de SOP (D.6).

### B.6.3 Punto logístico y ciclo de paños

- **Conteo simple por color:** "8 rojos, 6 azules" (D.7). No por unidad individual.
- **Estados:** limpio → asignado a vehículo → usado → sucio → lavado → bodega.
- **Segregación química:** Paños de zona roja (baño/ácido) nunca se lavan con azules (cocina/amonio).
- **Alerta:** Si paños limpios < mínimo para el día siguiente → PO automática + notificación admin.

---

## B.7 Canal No Tecnológico — Modo Coordinador (ADOPTADO en E1)

**Estado:** Integrado a E1, no como E6 independiente.
**Razón:** Doc 3 y 4 acertaron: excluir a clientes sin smartphone (mayores 65+, property managers tradicionales) es una brecha de mercado real en Richmond. Pero la solución no es un "módulo de telefonía"; es reutilizar el cotizador existente.

### B.7.1 Flujo "Reservar en nombre del cliente"

1. Coordinador/Dueño recibe llamada al número local (7AM-9PM).
2. Abre dashboard admin → botón "Nueva reserva (teléfono)".
3. El sistema carga el **MISMO cotizador web** (E1), pero con campo "Fuente: Teléfono" y "Agente: [Nombre del coordinador]".
4. Coordinador llena datos con el cliente en línea. El precio se calcula idéntico al flujo web.
5. Para pago:
   - **Opción A:** Cliente recibe SMS con link seguro para ingresar tarjeta (SetupIntent). El coordinador NUNCA ve los datos.
   - **Opción B:** Cliente sin smartphone → pago e-transfer/cheque/efectivo. Coordinador marca "Pago pendiente" en orden. Recibo firmado digitalmente en PWA del coordinador (no papel).
6. Confirmación automática 24h antes: IVR Twilio ("Presione 1 para confirmar, 2 para reagendar, 3 para cancelar"). Reintento 4h después. Fallback SMS → manual.

### B.7.2 Cliente sin smartphone — flujo post-servicio

- En lugar de galería web, coordinador llama 2h post-servicio: "¿Todo estuvo bien? ¿Alguna observación?"
- Si satisfecho: nada más.
- Si insatisfecho: coordinador crea ticket manual con misma priorización que web.
- Pago: e-transfer con número de orden en concepto. Conciliación manual en Shadow Ledger.

---

## B.8 Reservas de Última Hora / Same-Day (ADOPTADO como regla E3)

**Estado:** Regla de negocio en E3, no módulo nuevo.
**Razón:** Doc 4 identificó correctamente que un cliente que llama a las 9 AM para servicio a las 2 PM no tiene camino claro.

### B.8.1 Reglas del ciclo de emergencia

| Condición | Ventana horaria | Acción | Recargo |
|-----------|----------------|--------|---------|
| Reserva >5:30 PM día anterior | Normal | Ciclo 70/30 estándar | Ninguno |
| Reserva 5:30 PM – 10:00 AM mismo día | Emergencia | Admin/Coordinador recibe alerta. Si hay equipo en bench o jornada <6h, asigna manual. | +25% (transparente en cotización) |
| Reserva 10:00 AM – 2:00 PM mismo día | Ultra-emergencia | Solo si equipo en zona con servicio terminado pre-hora. Admin decide caso por caso. | +50% (transparente) |
| >2:00 PM para hoy | Rechazo automático | "Primer slot disponible: mañana a las [hora]" | N/A |

### B.8.2 Validaciones

- Ultra-emergencia requiere que el equipo tenga ≤8h totales incluyendo el nuevo servicio.
- No se aceptan same-day para Move-in/out o Post-construcción (HHE muy alto, imposible logístico).
- Score cliente <30: same-day bloqueado (riesgo operativo).

---

## B.9 Mejoras Operativas de Campo (ADOPTADAS en E4/E8)

**Origen:** Documento 3 (evaluación operativa).

### B.9.1 Modo "Guante Grueso" en PWA

- **Trigger:** Swipe hacia abajo desde el borde superior de la tablet.
- **Efecto:** Todos los hitboxes aumentan a 80px durante 30 segundos. Botones de acción crítica (completar zona, reportar daño) se amplían y se separan mínimo 16px.
- **Costo:** 0 infraestructura. CSS + JS state.
- **Razón:** Los guantes de limpieza reducen precisión táctil. Esta es una mejora de UX de costo cero y valor alto.

### B.9.2 Gestión de energía tablet

- **Checklist matutino (E8):** Verificación de batería ≥30%. Si <30%, alerta al líder: "Cargue la tablet antes de salir."
- **Modo ahorro:** Reducción automática de brillo al 40% cuando la tablet está inactiva >2 minutos en campo, pero GPS permanece activo (servicio en background).
- **Alerta:** Si batería <15% durante jornada, vibración + mensaje: "Conecte cargador en vehículo."

### B.9.3 Protocolo Airbnb — Staging Fail

- **Escenario:** La foto de referencia del host no coincide con la realidad tras limpieza (muebles movidos, daño nuevo, etc.).
- **Flujo:**
  1. Líder marca "Staging no coincide" en PWA + foto + nota.
  2. Sistema notifica al host (si contacto disponible) con opciones: "[Aceptar como está] [Enviar auditor] [Re-servar]".
  3. Si host no responde en 30 min → líder procede con cierre normal. El "staging fail" se documenta pero no bloquea el pago del equipo.
  4. Si host solicita re-serva → nueva orden generada con tarifa de turnaround (no penalidad para el equipo).
  5. Score del equipo: no afectado si el fail es documentado correctamente.

---

## B.10 Gate Financiero Explícito (ADOPTADO en Parte G)

**Estado:** Regla de gobierno, no código.
**Razón:** Doc 3 identificó que "verificar contra flujo de caja" no tiene número. Un negocio con margen de contribución del 35% puede quebrar si sus fijos consumen el 40%.

### B.10.1 Reglas de pausa automática

| Condición | Umbral | Acción automática |
|-----------|--------|-------------------|
| Fondo de emergencia < 1 mes de nómina + fijos | $[calculado dinámicamente] | Alerta roja en dashboard + email al dueño. Ninguna contratación nueva. |
| Fondo de emergencia < 2 semanas de nómina + fijos | $[calculado dinámicamente] | Pausa automática de: regalos nuevos (E9), campañas de marketing pagadas (E10), contratación de nuevos equipos. |
| Margen neto real negativo 2 meses seguidos | <0% | Reunión obligatoria con dueño antes de cualquier gasto discrecional. Sistema no permite override sin contraseña del dueño. |
| Exposición de Holds pendientes > 40% de caja disponible | >40% | Alerta naranja. Recomendación: reducir ventana de cancelación o aumentar Hold mínimo. |

### B.10.2 Cálculo del fondo de emergencia

```
Fondo_Emergencia_Minimo = (Nomina_Quincenal × 2) + (Costos_Fijos_Mensuales × 1)
```

- `Nomina_Quincenal`: suma de Day Rates de todos los empleados activos × 2.
- `Costos_Fijos_Mensuales`: renta, seguros, suscripciones, compensación del dueño.
- Actualización: automática cada ciclo de nómina.

---

## B.11 Auditoría y Compliance Fortalecido (ADOPTADO en E0/E9)

**Origen:** Docs 1, 2, 3.

### B.11.1 Audit Service (tabla `audit_log`)

Todo evento que modifica estado de negocio genera entrada:
- `timestamp`, `admin_id` (o `system` si automático), `tabla`, `registro_id`, `campo`, `valor_anterior`, `valor_nuevo`, `motivo` (obligatorio si manual), `hash_sha256` (de la entrada completa), `ip_address`, `session_id`.
- **Tabla dueño:** `modulo_audit`.
- **Retención:** 7 años (PIPEDA/CRA).
- **Acceso:** Solo Admin y Compliance (rol futuro). Empleados nunca ven sus propios logs de auditoría.

### B.11.2 Monitoreo legal — health-check

- **Feed de 7 entes** (E9.7) debe tener health-check propio: si feed sin actualizar >30 días → alerta "Monitoreo legal ciego" en bandeja unificada.
- **Revisión manual trimestral:** agendada automáticamente en calendario del dueño (1h, con checklist de verificación).

### B.11.3 PIPEDA operativo

- **Derecho de acceso:** Endpoint `/api/v1/cliente/mis-datos` exporta JSON completo en <48h.
- **Corrección:** Cliente solicita cambio → ticket interno → aprobación admin → snapshot del cambio.
- **Eliminación:** Soft delete + retención fiscal 2 años + purge automático tras 7 años.
- **Brecha:** Protocolo documentado en wiki: OIPC BC notificado en 72h, afectados notificados en 72h, post-mortem obligatorio.

---

## B.12 Fallback de 10 Minutos — Circuit Breaker Calificado (ADOPTADO en E7)

**Origen:** Doc 3.
**Mejora al v8.3:** Si el mismo tipo de fallback dispara >3 veces en 1 hora para un mismo equipo/zona, el sistema escala a Coordinador Operativo en lugar de seguir decidiendo solo.

### B.12.1 Escalación progresiva

```
1er fallback → Autopilot (reglas pre-aprobadas)
2do fallback (mismo tipo, misma entidad) → Autopilot + alerta amarilla a Coordinador
3er fallback (mismo tipo, misma entidad) → Autopilot + alerta roja + Coordinador debe intervenir
4to fallback → Bloqueo manual obligatorio. Autopilot NO decide más para esta entidad hasta revisión humana.
```

---

## B.13 Telefonía Semántica — Reconsideración de Alcance (ADOPTADO en E6)

**Estado:** IVR tradicional en E6 MVP. LLM semántico como feature flag APAGADO hasta volumen >100 llamadas/mes.
**Razón:** Con presupuesto $8-15/mes fijo, una llamada de 3 min con GPT-4o Voice cuesta ~$0.20. 100 llamadas = $20, superando el presupuesto. Un IVR tradicional con Twilio cuesta ~$0.01/minuto.

### B.13.1 Arquitectura IVR (MVP)

```
Llamada entrante
    ↓
Twilio (Caller ID)
    ↓
Edge Function: cruzar con órdenes del día
    ↓
TTS en idioma de la cuenta: "Su equipo llega en 12 minutos. Presione 1 para confirmar..."
    ↓
DTMF (tonos) o Speech-to-Text simple (palabras clave: "estado", "cancelar", "reclamo")
    ↓
Enojo detectado (volumen/velocidad/palabras clave negativas) → bypass inmediato a humano
```

### B.13.2 LLM Semántico (feature flag `telefonia_llm`)

- Activación condicional: >100 llamadas/mes durante 2 meses consecutivos.
- Modelo: GPT-4o-mini o Claude Haiku (costo ~$0.03/llamada).
- RAG con base de conocimiento Lulu (SOP, políticas, FAQ).
- **Restricción:** Solo clasifica, informa y enruta. NUNCA finge conversación humana. Si el cliente dice "hablar con persona" → transferencia en <3 segundos.

---

## B.14 Estrategia i18n Técnica (ADOPTADA en E0)

**Estado:** Definida en E0 antes del primer componente UI.
**Razón:** 3 idiomas en producto desde el día 1. Sin estrategia, cada desarrollador hardcodeará strings.

### B.14.1 Stack

- **Next.js (Cliente + Admin):** `next-intl` con JSON estáticos para UI del sistema.
- **Textos administrables:** Tabla `i18n_catalogo` en Supabase para mensajes de negocio (emails, SMS, notificaciones push). Editables por admin sin deploy.
- **Detección:** Idioma preferido de `cuenta_cliente.idiomas_priorizados[0]`, fallback a browser locale, fallback final a inglés.
- **PWA:** `react-i18next` con JSON embebido en build (offline-first).

### B.14.2 Métricas CJK

- `--font-cjk: 'Noto Sans SC', sans-serif`
- `line-height: 1.75` (vs 1.5 para latino)
- `letter-spacing: 0.05em` para títulos CJK
- Validación visual obligatoria con texto real en chino antes de aprobar wireframes.

---

# PARTE C: MEJORAS RECHAZADAS (Documentadas para evitar reconsideración prematura)

## C.1 Workflow Engine separado → RECHAZADO

**Quién lo propuso:** Docs 1, 2, 4.
**Por qué se rechaza:**
- Un negocio con 3 equipos de limpieza no tiene workflows lo suficientemente complejos como para justificar un motor dedicado (Temporal, Camunda, o casero).
- El v8.3 ya maneja estados vía `orden_servicio.estado` con transiciones validadas por triggers PostgreSQL. Eso ES un workflow, solo que no compramos una marca.
- Costo de oportunidad: 2-4 semanas de desarrollo para un motor que no resuelve ningún problema real hoy.

**Cuándo reconsiderar:** >15 equipos activos Y >3 tipos de workflow que no caben en una tabla de estados. Gate: volumen, no tiempo.

**Alternativa adoptada:** Estados en tabla + Edge Functions con validación de transición + `audit_log`.

---

## C.2 Event Sourcing / CQRS completo → RECHAZADO

**Quién lo propuso:** Doc 4.
**Por qué se rechaza:**
- Event Sourcing convierte "¿cuánto le debo a María Pérez?" en "replayear 500 eventos". Para un sistema con <1000 órdenes/mes, es masoquismo técnico.
- El Shadow Ledger (E2) YA es una proyección de eventos financieros. No necesitamos replicar ese patrón en todo el sistema.
- Requiere devops dedicado para manejar snapshots, versionado de eventos, y migraciones de schema de eventos.

**Cuándo reconsiderar:** >10,000 órdenes/mes Y necesidad forense de reconstruir cualquier estado a cualquier momento. Gate: volumen + requerimiento legal explícito.

**Alternativa adoptada:** PostgreSQL como fuente de verdad + `event_log` append-only para auditoría y desacoplamiento ligero. No es Event Sourcing; es audit logging con polling.

---

## C.3 Identity Service separado → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- Supabase Auth YA gestiona SSO (Google, Apple), JWT, sesiones, MFA futuro, y RBAC base.
- Construir un Identity Service propio es reinventar la rueda cuando la rueda viene incluida y cuesta $0 en el tier gratuito.
- El v8.3 tiene 3 roles fijos (Admin, Coordinador, Solo-QC). No justifica ABAC ni policies dinámicas.

**Cuándo reconsiderar:** Necesidad de integrar con Active Directory corporativo de un cliente B2B grande, o requerimiento de SSO SAML. Gate: cliente real con ese requerimiento.

**Alternativa adoptada:** Supabase Auth + tabla `empleado` con campos de rol. RBAC validado en Edge Functions con middleware.

---

## C.4 Permission Engine (ABAC) → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- 3 roles fijos no justifican un motor de políticas con claims, scopes y evaluación dinámica.
- Cada regla de permiso añadida aumenta complejidad exponencialmente. Hoy necesitamos "Admin ve todo, Coordinador no ve nómina, QC solo fotos". Eso es un `if/else`, no un motor.

**Cuándo reconsiderar:** >10 roles distintos o necesidad de permisos por atributo (ej: "Coordinador A ve zona norte, Coordinador B ve zona sur"). Gate: complejidad real de operación.

**Alternativa adoptada:** Middleware de RBAC en Edge Functions con tabla `rbac_permissions` simple (rol, recurso, acción).

---

## C.5 Analytics Service separado → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- Con 5-10 clientes del piloto, una query SQL en PostgreSQL ES tu analytics.
- Replicar datos a ClickHouse, BigQuery o similar añade $50-200/mes en infraestructura, destruyendo el presupuesto "casi cero".
- El dashboard del dueño (D.13) son 5 queries agregadas. No necesita un servicio dedicado.

**Cuándo reconsiderar:** >1000 órdenes/mes Y queries de analytics que degradan performance de producción. Gate: evidencia de bottleneck medido.

**Alternativa adoptada:** Materialized views en PostgreSQL para métricas diarias. Export CSV en E9. Dashboard consume views, no tablas transaccionales.

---

## C.6 Reporting Engine separado → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- Generar un PDF de nómina o una factura no requiere un "motor". Requiere una plantilla (HTML → PDF) y una función que la llene con datos.
- QuickBooks Online YA genera reportes fiscales. El sistema solo necesita exportar datos en formato que QBO consuma.

**Cuándo reconsiderar:** Necesidad de reportes regulatorios complejos (ej: WorkSafeBC con formatos específicos no cubiertos por QBO). Gate: requerimiento legal no cubierto.

**Alternativa adoptada:** Edge Function `generar_reporte` que toma template HTML + datos JSON → Puppeteer/Playwright → PDF. Una función, no un motor.

---

## C.7 Integration Service Orquestador → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- Los adaptadores del v8.3 (C.2.2) YA SON la anti-corruption layer. Un "orquestador" encima sería una capa que añade latencia y puntos de fallo sin valor.
- Retry, rate limit, circuit breaker y DLQ deben vivir EN CADA ADAPTADOR, no en un orquestador genérico. Así, si el adaptador de Stripe necesita retry exponencial pero el de Maps necesita cache TTL, cada uno decide sin afectar al otro.

**Cuándo reconsiderar:** >10 integraciones externas activas simultáneamente. Gate: número real de adaptadores.

**Alternativa adoptada:** Carpeta `adapters/` con interfaz común (`connect`, `request`, `retry`, `circuitBreaker`) pero implementación específica por proveedor.

---

## C.8 Motor de Reglas como Servicio HTTP separado → RECHAZADO

**Quién lo propuso:** Docs 1, 2.
**Por qué se rechaza:**
- El motor IF/THEN del v8.3 (E1.5) es lógica de negocio que vive mejor como librería (`packages/pricing-engine`) que como servicio remoto.
- Un servicio HTTP añade latencia de red a cada cotización. Una librería se ejecuta en la misma Edge Function.
- El v8.3 tiene UN campo editable (tarifa objetivo) y 20 celdas derivadas. No es un sistema de reglas enterprise.

**Cuándo reconsiderar:** Motor de reglas usado por >3 módulos con lógicas distintas (precios, despacho, nómina, riesgo) Y volumen >500 evaluaciones/hora. Gate: perfil de performance medido.

**Alternativa adoptada:** Librería `pricing-engine.ts` importada por Cotizador y Despacho. Motor IF/THEN como función pura con Zod validation.

---

# PARTE D: MAPA DE DECISIÓN ARQUITECTÓNICA

Esta matriz resume qué se adopta, qué se rechaza, y el gate para reconsiderar.

| Decisión | Estado | Gate para reconsiderar | Costo de no esperar |
|----------|--------|------------------------|---------------------|
| Event Map ligero | ✅ Adoptado | Nunca. Es MVP. | Caos de eventos sin nombre. |
| Data Ownership Matrix | ✅ Adoptado | Nunca. Es MVP. | Corrupción de datos multi-módulo. |
| API Contracts (Zod) | ✅ Adoptado | Nunca. Es convención. | Bugs de integración silenciosos. |
| Sync Protocol PWA | ✅ Adoptado | Nunca. Es MVP. | Pérdida de evidencia en campo. |
| Pipeline Evidencia | ✅ Adoptado | Nunca. Es MVP. | Disputas sin fotos = pérdida de dinero. |
| Inventario conectado | ✅ Adoptado | Nunca. Bloqueante E3. | Equipo sin insumos = servicio fallido. |
| Canal telefónico (modo coord.) | ✅ Adoptado | Nunca. Es mercado real. | Pérdida de segmento demográfico clave. |
| Same-day / Emergencia | ✅ Adoptado | Nunca. Es regla de negocio. | Pérdida de ingresos por rigidez. |
| Gate financiero explícito | ✅ Adoptado | Nunca. Es supervivencia. | Quiebra con margen aparentemente bueno. |
| Fallback con circuit breaker | ✅ Adoptado | Nunca. Es mejora de seguridad. | Autopilot tomando decisiones erróneas en cascada. |
| IVR tradicional (MVP) | ✅ Adoptado | >100 llamadas/mes | Costo innecesario si nadie llama. |
| LLM semántico | ❌ Rechazado | >100 llamadas/mes × 2 meses | Presupuesto destruido. |
| Workflow Engine | ❌ Rechazado | >15 equipos + workflows complejos | 2-4 semanas de desarrollo sin retorno. |
| Event Sourcing / CQRS | ❌ Rechazado | >10,000 órdenes/mes | Complejidad letal para debugging. |
| Identity separado | ❌ Rechazado | Requerimiento SAML/AD real | Reinventar Supabase Auth. |
| Permission Engine (ABAC) | ❌ Rechazado | >10 roles o permisos por atributo | Overhead para 3 roles fijos. |
| Analytics separado | ❌ Rechazado | Queries degradan producción | $50-200/mes innecesarios. |
| Reporting Engine | ❌ Rechazado | Reportes regulatorios no cubiertos | Una función genera PDFs suficiente. |
| Integration Orquestador | ❌ Rechazado | >10 integraciones activas | Capa sin valor sobre adaptadores. |
| Motor de Reglas como servicio | ❌ Rechazado | >500 evaluaciones/hora | Latencia de red por cada cotización. |

---

# PARTE E: CRONOGRAMA DE INTEGRACIÓN AL v8.3

| Mejora | Etapa de integración | Entregable | Bloquea siguiente etapa? |
|--------|---------------------|----------|-------------------------|
| B.1 Event Map | E0 (antes de primera migración de negocio) | `events.ts` + tabla `event_log` | Sí — E1 no puede publicar eventos sin catálogo. |
| B.2 Data Ownership | E0 (comentario en cada migración) | Matriz firmada en repo | Sí — violación = rechazo de PR. |
| B.3 API Contracts | E0 (convención de monorepo) | `packages/schemas` + tests | Sí — PR sin Zod = rechazo. |
| B.14 i18n Strategy | E0 (antes del primer componente) | Config `next-intl` + tabla `i18n_catalogo` | No — pero costoso retroceder. |
| B.5 Pipeline Evidencia | E0 (esquema) + E4 (implementación) | Tabla + Edge Function + Storage | Sí para E5 (QC necesita fotos). |
| B.4 Sync Protocol | E4 (antes de primera jornada offline) | Documento técnico + implementación PWA | Sí — sin esto, E4 es inseguro. |
| B.6 Inventario conectado | E3 (antes de primer despacho real) | Wireado en dispatch + PWA consumo | 🚨 Sí — bloqueante. |
| B.7 Canal telefónico | E1 (modo coordinador) + E6 (IVR) | Botón "Reservar teléfono" + Twilio IVR | No — pero pérdida de mercado. |
| B.8 Same-day | E3 (regla en motor de despacho) | Lógica + tests de recargo | No — pero pérdida de ingresos. |
| B.9 UX Campo | E4 (modo guante grueso) + E8 (energía) | CSS + checklist matutino | No — mejora calidad de vida. |
| B.10 Gate financiero | Parte G (regla de gobierno) | Dashboard widget + alertas | No — pero supervivencia. |
| B.11 Audit fortalecido | E0 (tabla) + E9 (compliance) | `audit_log` + health-check legal | Sí para E9 (PIPEDA/CRA). |
| B.12 Fallback circuit breaker | E7 (consolidación excepciones) | Lógica de escalación + tests | No — mejora robustez. |
| B.13 Telefonía LLM | E10 (feature flag apagado) | Arquitectura documentada | No — activación condicional. |

---

# PARTE F: GLOSARIO DE ESTE ANEXO

**Event Map:** Catálogo canónico de eventos de dominio con schema Zod. No es Event Sourcing; es nomenclatura estándar.
**Data Ownership:** Principio de que solo un módulo puede escribir en una tabla. Los demás leen vía API o proyección.
**Sync Protocol:** Reglas de resolución de conflictos entre estado local (PWA offline) y estado servidor.
**Gate financiero:** Regla numérica que pausa gastos discrecionales si la salud financiera del negocio cae bajo umbral.
**Circuit breaker calificado:** Escalación progresiva del Fallback de 10 minutos si se dispara repetidamente para la misma entidad.
**Modo coordinador:** Flujo de reserva telefónica que reutiliza el 100% del cotizador web, evitando duplicar código.

---

*Anexo adoptado el 4 de Agosto, 2026. Se integra al v8.3 como documento de referencia obligatoria para toda decisión de construcción.*
*Principio rector de este anexo: la arquitectura debe servir al negocio, no al revés. Cada línea de código que no resuelve un problema real de limpieza es una línea que tendremos que mantener mañana.*
