> **ACTUALIZACIÓN (7 de agosto, minutos después del hallazgo):** el equipo desplegó el commit `2e92565` ("fix: update Supabase SSR cookie API — getAll/setAll, remove forced httpOnly overrides"), que corrige exactamente la causa raíz descrita en el Hallazgo 2. Re-probé el flujo completo de Google en producción (login → `/en/account` → recarga en frío) y **ya funciona correctamente**: la sesión se reconoce y persiste. Detalle de la verificación al final del documento.

# Auditoría del sistema de login — luluislandflagship.ca

**Fecha:** 6-7 de agosto de 2026 (actualizado)
**Alcance:** Modal de login de clientes (`/en/cuenta/servicios`, `AuthModal.tsx`), flujo completo de OAuth con Google hasta `/en/account`, y estado de despliegues en Vercel.
**Método:** Pruebas en vivo sobre producción con Claude in Chrome (clicks reales con referencia de elemento, no coordenadas), inspección de network requests/console/cookies, y revisión de logs de runtime + historial de deployments en Vercel.

## Resumen ejecutivo

Hay **un bug real y activo** que hace que el login con Google (y probablemente Apple, cuando se reactive) parezca "no servir": el usuario completa el login correctamente en Google, pero al volver al sitio, la sesión no es reconocida y se le vuelve a mostrar el modal de login — en un loop.

Además, se encontró algo más urgente: **el repositorio está recibiendo despliegues automáticos a producción que yo no hice**, varios de ellos rotos (build ERROR). Esto es información nueva e importante, no solo un detalle técnico.

## Hallazgo 1 (actualizado): "Continue with Apple" ya está oculto

Confirmado en vivo: el modal ahora solo muestra 3 opciones (Google, Email+código, Teléfono+SMS). Alguien ya aplicó la Opción A que propuse en el reporte anterior (ocultar el botón mientras Apple OAuth no esté habilitado en Supabase) — ver Hallazgo 3 para el commit exacto.

## Hallazgo 2 (NUEVO, root cause real): la sesión de Google no se reconoce después del login

Reproducido de forma consistente, dos veces:

1. Click en "Sign In" → modal se abre.
2. Click en "Continue with Google" → Google abre el selector de cuentas correctamente.
3. Se elige una cuenta → Google redirige a `/auth/callback?code=...&next=/en/account` → esa petición responde **200** y redirige a `/en/account`.
4. En `/en/account`: **el modal de login vuelve a aparecer**, como si nunca te hubieras autenticado. Recargar la página no lo arregla.

**Causa raíz identificada en el código** (`src/app/auth/callback/route.ts`, líneas 84-89):

```ts
set(name: string, value: string, options: CookieOptions) {
  cookieStore.set({ name, value, ...options, path: "/", httpOnly: true, secure: true, sameSite: "lax" });
},
```

Este bloque fuerza `httpOnly: true` en **todas** las cookies que Supabase intenta guardar durante el intercambio del código de OAuth — incluida la cookie de sesión real (`sb-...-auth-token`), no solo las cookies internas de PKCE que sí deberían ser `httpOnly`.

El problema: el cliente de Supabase en el navegador (`src/lib/supabase.ts`, usa `createBrowserClient` de `@supabase/ssr`) necesita **leer esa misma cookie desde JavaScript** para saber que hay una sesión activa (`supabase.auth.getUser()` en `src/app/[locale]/account/layout.tsx`, línea 78). Una cookie `httpOnly` es invisible para JavaScript por diseño del navegador — es una protección contra robo de tokens vía XSS, pero aquí bloquea al propio cliente legítimo.

Evidencia que lo confirma:
- Las cookies visibles por JS en el navegador después del login son solo las de PKCE (`...-code-verifier`), nunca una cookie de sesión — consistente con que la de sesión sí se creó pero quedó oculta por `httpOnly`.
- Al cargar `/en/account`, el navegador hace **cero peticiones de red hacia Supabase** — el cliente ni siquiera intenta validar sesión porque no encuentra ningún token que enviar.
- El resultado es que `checkSession()` en `account/layout.tsx` concluye "unauthenticated" y vuelve a pintar el `AuthModal`, sin importar cuántas veces se repita el login.

**Por qué antes parecía que Google "sí funcionaba":** en la auditoría anterior solo verifiqué que el botón abriera el selector de cuentas de Google — nunca completé el flujo hasta el final. Esta vez sí lo completé de principio a fin y ahí apareció el problema real.

**Alcance del impacto:** afecta a cualquier login que pase por `/auth/callback` — es decir, Google y (cuando se reactive) Apple. Los métodos de Email+código y Teléfono+SMS probablemente NO estén afectados porque no pasan por este archivo (usan `verifyOtp` directo desde el cliente), pero no se confirmó en esta ronda.

No se modificó nada — solo diagnóstico, según pediste.

## Hallazgo 3 (NUEVO, urgente, no relacionado al login): despliegues no controlados a producción

Al revisar el historial de deployments en Vercel encontré una cadena larga de commits push directos a `main` que yo no hice ni reconozco de esta conversación, con mensajes como:

- "fix: remaining TDZ errors in service page, checklist, voting"
- "fix: clean TDZ in service page — loadLogs before loadService, useEffect after declarations"
- "fix: remove orphaned loadLogs duplicate closing brace"
- "fix: NextParamAuthGate — skip AuthModal if already authenticated (post-OAuth redirect)"
- "fix: hide Apple OAuth button — provider not enabled in Supabase"
- "feat: Apple OAuth admin toggle — on/off from Content panel, no env var needed" (el más reciente, **en estado ERROR**, no llegó a producción)

De los últimos ~20 deployments, **8 terminaron en estado ERROR** (build roto). Producción está sirviendo actualmente el último que sí compiló bien: commit `a876a0b` ("hide Apple OAuth button"), del cual ya sabemos que el problema del Hallazgo 2 (introducido antes, en el commit `919211...` "NextParamAuthGate") sigue sin arreglarse.

Esto sugiere que hay otro proceso o agente automatizado con acceso de escritura a tu repo (`main`) haciendo commits y desplegando directo a producción, con bastante ensayo-y-error visible en los propios mensajes de commit ("remaining TDZ errors", "clean TDZ", "remove orphaned..." — son 3 intentos seguidos de arreglar lo mismo). Si esto no lo autorizaste tú directamente, vale la pena que revises quién/qué tiene ese acceso, porque ahora mismo está desplegando a producción sin que yo lo vea ni lo controle desde esta conversación.

## Resumen de estado actual

| Método de login | Estado |
|---|---|
| Google | Se autentica en Google correctamente, pero la sesión no se reconoce al volver al sitio — el usuario queda atrapado en el modal de login. **Roto.** |
| Apple | Botón oculto (ya no genera el error JSON del reporte anterior). No probado más allá porque está oculto. |
| Email + código | No probado en esta ronda. |
| Teléfono + SMS | No probado en esta ronda. |

## Arreglo sugerido (no aplicado — solo para referencia, dijiste que no arreglara nada)

En `src/app/auth/callback/route.ts`, dejar de forzar `httpOnly: true` sobre todas las cookies y respetar las `options` que Supabase ya decide por cookie (mismo patrón que `src/lib/supabase-server.ts`, que no fuerza `httpOnly` y es el que usan ~146 rutas API sin este problema):

```ts
set(name: string, value: string, options: CookieOptions) {
  cookieStore.set({ name, value, ...options, path: "/", secure: true, sameSite: "lax" });
},
```

Esto dejaría que Supabase marque `httpOnly` solo en las cookies internas de PKCE (donde sí tiene sentido) y no en la cookie de sesión real (que el cliente necesita leer).

## Verificación post-fix (7 de agosto)

El equipo aplicó exactamente este cambio (commit `2e92565646...`, desplegado como `dpl_B65utN5t5T27J4n5rF8jUt82fVKf`, estado READY en producción). Repetí la prueba completa en vivo:

1. Sign In → Continue with Google → elegir cuenta en Google → redirige a `/en/account`.
2. Resultado: pantalla "Welcome back!" con el dashboard del cliente completo (My Services, My Properties, Lulu Wallet, etc.) — ya no vuelve a mostrar el modal de login.
3. Recargué `/en/account` en frío (navegación nueva, no solo refresh de React) — la sesión sigue activa. Esto confirma que la cookie de sesión ahora sí es legible por el cliente y persiste entre cargas de página.

**Conclusión: el login con Google funciona correctamente ahora mismo en producción.** No se probaron en esta ronda Email+código ni Teléfono+SMS (no tenían el problema descrito, pero tampoco se re-confirmaron).
