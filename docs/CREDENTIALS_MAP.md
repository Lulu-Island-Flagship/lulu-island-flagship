# 🗺️ Mapa de Credenciales — Lulu Island Flagship
# Última actualización: 2026-08-04
# Para Codewhale y cualquier IA que trabaje en este proyecto:
# NO pidas claves al usuario. Están todas documentadas aquí.

## Supabase (producción)
# Project ref: eadgocbmfnqfpgvoutvp
# Dashboard: https://supabase.com/dashboard/project/eadgocbmfnqfpgvoutvp
ENV_FILE=.env.production.local
  SUPABASE_PROJECT_ID=eadgocbmfnqfpgvoutvp
  PROD_SUPABASE_URL=https://eadgocbmfnqfpgvoutvp.supabase.co
  PROD_SUPABASE_ANON_KEY=<leer del archivo>
  SUPABASE_ACCESS_TOKEN=<leer del archivo>
ENV_FILE=.env.local
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321  # local dev
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<leer del archivo>  # local dev
VERCEL=configurado
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY

## Stripe
ENV_FILE=.env.local
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<leer del archivo>
  STRIPE_SECRET_KEY=<leer del archivo>  # LIVE: sk_live_...
VERCEL=configurado
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET

## Vercel
# Project: lulu-island-flagship
# Dashboard: https://vercel.com/luluislandflagship/lulu-island-flagship
# Project ID: prj_c1wI0Z1elmgfR11jxaoKYDogtQiw
ENV_FILE=.env.production.local
  VERCEL_TOKEN=<leer del archivo>
# API: curl -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/...

## GitHub
# Repo: Lulu-Island-Flagship/lulu-island-flagship
# https://github.com/Lulu-Island-Flagship/lulu-island-flagship

## Archivos que NUNCA se commitean (.gitignore)
# .env.local
# .env.production.local
# .env
