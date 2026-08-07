# Auditoría del sistema de login — luluislandflagship.ca

**Fecha:** 6 de agosto de 2026
**Alcance:** Modal de login de clientes (`/en/cuenta/servicios`, `AuthModal.tsx`) y Team Portal (`StaffLoginScreen.tsx`)
**Método:** Pruebas en vivo sobre producción con Claude in Chrome (clicks reales, inspección de network requests y console logs)

## Resumen

El login **sí funciona** en general. Se encontró **un bug real** en una de las cuatro opciones del modal de clientes: el botón de Apple. Las demás opciones probadas funcionan correctamente.

## Hallazgos

### 1. Botón "Sign In / Sign Up" (header) — OK
Abre correctamente el modal "Sign In or Sign Up to Reserve" con sus 4 opciones (Google, Apple, Email+código, Teléfono+SMS).

### 2. "Continue with Google" — OK
Abre el selector de cuentas de Google (`accounts.google.com/.../accountchooser`) con `prompt=select_account`, forzando siempre a elegir cuenta en vez de reusar sesión activa silenciosamente (fix aplicado en esta misma auditoría, sesión anterior). Confirmado funcionando tanto en el modal de clientes como en el login de staff.

### 3. "Continue with Apple" — BUG CONFIRMADO
Al hacer clic, el navegador sale completamente del sitio y muestra una página de error JSON cruda de Supabase:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

**Causa:** el proveedor Apple OAuth no está habilitado en Supabase (Auth → Providers → Apple). El botón está visible y es clickeable en la UI, pero el backend lo rechaza.

**Impacto:** cualquier visitante que intente entrar con Apple abandona el sitio y ve una pantalla de error técnica sin marca ni forma de regresar — se percibe como "el login no sirve", aunque solo afecta a esa opción.

**No se tocó código ni configuración** — solo diagnóstico, según lo pedido.

### 4. Email + código / Teléfono + SMS — no probados en esta ronda
No se ejecutó una prueba completa de extremo a extremo de estas dos opciones en esta auditoría (el foco fue Google/Apple, que eran las señaladas). Quedan pendientes si se quiere cobertura total.

## Causa raíz y relación con pendientes ya conocidos

Este hallazgo coincide con uno de los 3 pendientes de dashboard que ya tenías identificados:
1. **Habilitar Apple OAuth** (Supabase → Auth → Providers → Apple) ← relacionado directamente con este bug
2. Habilitar Phone OTP
3. Configurar webhook de Stripe

## Opciones de arreglo (no aplicadas, solo para referencia)

- **Opción A (rápida, sin tocar Supabase):** ocultar el botón de Apple en el modal hasta que el proveedor esté habilitado.
- **Opción B (mejor UX):** capturar el error antes de que la página navegue fuera del sitio y mostrar un mensaje amigable dentro del modal en vez de la pantalla JSON cruda.
- **Opción C (raíz):** habilitar Apple OAuth en el dashboard de Supabase — resuelve el problema sin cambios de código, pero requiere tener las credenciales de Apple Developer configuradas.

Ninguna de estas se aplicó; este documento es solo el reporte solicitado.
