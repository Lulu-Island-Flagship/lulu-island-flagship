# Auditoría de Navegación — 2026-08-07

## Botones de admin removidos (pendientes de revisión futura)

- **Compliance** (`/admin/compliance`) — link en AdminNav.tsx removido (línea ~134). La página nunca fue creada. Revisar en versión futura si se necesita un panel de compliance para reglas legales.
- **Payroll Remittances** (`/admin/payroll-remittances`) — link removido (línea ~137). La página nunca fue creada. Revisar junto con el endpoint `POST /api/admin/payroll/execute` ya implementado en v9.2.

Ambos fueron agregados en v8.4 pero las páginas nunca se construyeron. El código comentado en AdminNav.tsx contiene los labels originales para referencia.

## Páginas admin existentes sin acceso desde navegación

Estas páginas tienen su `page.tsx` funcional pero ningún menú, tarjeta de dashboard, o sidebar lleva a ellas:

| Página | Ruta | Nota |
|--------|------|------|
| Content | `/admin/content` | Gestión de contenido del sitio |
| Entity Notes | `/admin/entity-notes` | Notas de entidades |
| Feature Flags | `/admin/feature-flags` | **Crítico**: aquí se activa/desactiva el marketplace de turnos |
| Route Shortcuts | `/admin/route-shortcuts` | Atajos de ruta |
| Succession | `/admin/succession` | Plan de sucesión |
| Tax | `/admin/tax` | Panel de impuestos |
| Weather Exceptions | `/admin/weather-exceptions` | Excepciones de clima |

## Portal cliente: corrección de rutas (v9.2)

15 enlaces en `CuentaNav.tsx` y `MisServiciosClient.tsx` usaban nombres de ruta en español cuando las carpetas reales de Next.js App Router están en inglés. Corregido:

- `servicios` → `services`
- `propiedades` → `properties`
- `billetera` → `wallet`
- `referidos` → `referrals`
- `preferencias` → `preferences`
- `perfil` → `profile`
- `galeria` → `gallery`
- `cancelacion` → `cancellation`
- `reserva` → `booking`
- `privacidad` → `privacy`
- Prefijo `cuenta/` → `account/`
