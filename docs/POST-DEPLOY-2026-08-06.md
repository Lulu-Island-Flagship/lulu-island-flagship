# Post-Deploy Checklist — 6 Agosto 2026

## 🗄️ Supabase — Migraciones pendientes

Correr contra el proyecto remoto (producción):
```bash
supabase db push
```
NUNCA `supabase db reset` en prod.

Migraciones nuevas:
- **360**: FK `communication_preferences.user_id` + `message_context.linked_by_user_id` → `auth.users`
- **361**: `REVOKE EXECUTE ON set_current_fixed_costs FROM PUBLIC, anon`
- **362**: `legal_monitoring_*` — solo supervisors pueden leer
- **363**: `reglas_legales` — authenticated solo ve `VIGENTE`
- **364**: Sentinel contra re-ejecución de conversión dólares→centavos

## 📧 Supabase Dashboard — Manual

1. Ir a Authentication → Email Templates
2. Editar "Confirm signup" — sin este template, nadie puede loguearse por email.
   (Ver `PENDIENTES-PARA-TI.md` para detalles)

## ⏱️ Vercel Crons

- **48 crons** en `vercel.json` — límite Pro = **40**
- Si estás en **Hobby**: los crons `*/2` y `*/5` NO CORREN (solo daily)
- Crons de seguridad humana que DEBEN correr sub-diario:
  - `safety-abort-escalation` (`*/2 min`) — SOS empleado en campo
  - `wellbeing-chemical-reassign` (`*/5 min`) — exposición química
  - `key-escalation-check` (`*/5 min`) — incidente de llaves
- **Recomendación**: Verificar plan Vercel. Si es Hobby, upgradear a Pro ASAP.
