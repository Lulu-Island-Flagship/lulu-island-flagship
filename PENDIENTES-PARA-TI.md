# Lo que falta — solo copiar y pegar

Última actualización: 1 de agosto de 2026.

Todo lo que se podía arreglar en código ya está arreglado, commiteado y (una vez hagas `git push`) desplegado automáticamente por Vercel. Lo único que queda son 2 pasos manuales en el panel de Supabase — nadie más que tú puede hacerlos porque requieren tu login al dashboard.

---

## ✅ Paso 0 — Subir el último commit

Ya hice el commit local. Corre esto en tu terminal, en la carpeta del proyecto:

```
git push origin main
```

(Si ya lo hiciste después de leer este mensaje, puedes saltar directo al Paso 1.)

---

## 🔲 Paso 1 — Plantilla de email "Confirm signup" (clientes nuevos)

**Por qué:** un cliente que nunca inició sesión antes recibe este correo. Hoy trae un link ("Confirm your email address"), pero la pantalla de login pide un código de 6 dígitos. Sin este paso, **ningún cliente nuevo puede terminar de loguearse por email.**

1. Ve a [supabase.com/dashboard](https://supabase.com/dashboard) → proyecto **flagship cleaning**.
2. Menú izquierdo → **Authentication** → **Email Templates**.
3. Selecciona la plantilla **Confirm signup**.
4. Borra todo el campo **Subject** y pega esto:

```
Your verification code
```

5. Borra todo el campo **Message body** (o "Source") y pega esto completo:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your verification code</title>
  </head>
  <body style="margin:0; padding:0; background-color:#eef5fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef5fa; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; padding:40px 32px; max-width:480px; width:100%;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <span style="font-size:18px; font-weight:700; color:#1e3a5f;">Lulu Island Flagship</span>
                <br />
                <span style="font-size:12px; color:#6b7280;">Cleaning Services</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:16px; color:#1f2937; line-height:1.5; padding-bottom:16px;">
                Welcome! Use this code to confirm your email and sign in. It expires shortly, and works only once.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 0 24px;">
                <span style="display:inline-block; font-size:32px; font-weight:700; letter-spacing:8px; color:#1e3a5f; background-color:#eef5fa; padding:16px 24px; border-radius:8px;">
                  {{ .Token }}
                </span>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px; color:#6b7280; line-height:1.5; padding-bottom:8px;">
                Didn't request this? You can safely ignore this email — no account changes were made.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

6. Click **Save**.

---

## 🔲 Paso 2 — Plantilla de email "Magic Link" (clientes que ya tienen cuenta)

**Por qué:** mismo problema, pero para un cliente que ya inició sesión antes y vuelve a entrar. Sin este paso, esos clientes tampoco pueden loguearse.

1. Mismo lugar: **Authentication** → **Email Templates**.
2. Selecciona la plantilla **Magic Link**.
3. Borra el campo **Subject** y pega:

```
Your verification code
```

4. Borra el campo **Message body** y pega esto completo (es casi idéntico al de arriba, solo cambia una línea de texto):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your verification code</title>
  </head>
  <body style="margin:0; padding:0; background-color:#eef5fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef5fa; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; padding:40px 32px; max-width:480px; width:100%;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <span style="font-size:18px; font-weight:700; color:#1e3a5f;">Lulu Island Flagship</span>
                <br />
                <span style="font-size:12px; color:#6b7280;">Cleaning Services</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:16px; color:#1f2937; line-height:1.5; padding-bottom:16px;">
                Use this code to sign in. It expires shortly, and works only once.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 0 24px;">
                <span style="display:inline-block; font-size:32px; font-weight:700; letter-spacing:8px; color:#1e3a5f; background-color:#eef5fa; padding:16px 24px; border-radius:8px;">
                  {{ .Token }}
                </span>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px; color:#6b7280; line-height:1.5; padding-bottom:8px;">
                Didn't request this? You can safely ignore this email — no account changes were made.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

5. Click **Save**.

---

## ✅ Cómo verificar que quedó bien

Después de guardar ambas plantillas:

1. Abre el sitio en una ventana de incógnito → botón **Sign In** → **Email + Verification Code** → escribe un correo tuyo (uno que nunca hayas usado en el sitio, para probar el caso "cliente nuevo" del Paso 1).
2. El correo que llegue debe traer un **código de 6 dígitos grande**, no un botón/link.
3. Repite con un correo que ya tenga cuenta (para probar el Paso 2).

Si algo no cuadra, mándame captura del correo real que llegó y lo reviso.

---

## Estado de páginas del portal de cliente (probado en vivo, 1 ago 2026)

| Página | Estado |
|---|---|
| Login (email OTP) | ✅ funciona — pendiente Pasos 1-2 arriba para que el correo sea correcto |
| My Services | ✅ |
| My Properties (crear/editar/borrar) | ✅ |
| Lulu Wallet | ✅ |
| Lulu Ambassador | ✅ |
| Preferences | ✅ (corregido hoy, ya en producción) |
