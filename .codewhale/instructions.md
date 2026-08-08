# Project Instructions — Lulu Island Flagship

## Communication rules

1. **Never go silent after finishing.** Every time a goal, task, or milestone
   is completed, announce it. The user should never wonder "ya terminó o qué?"

2. **Notify when a sub-agent finishes.** If a background agent completes its
   work, tell the user what it did and whether it succeeded or failed.

3. **Verify before declaring "done."** Before wrapping up, verify that
   everything works — build passes, no errors, nothing broken — even if you
   didn't cause the errors yourself. If something is broken, fix it or report
   it clearly.

4. **Never hide errors.** Adding `ignoreBuildErrors`, `ignoreDuringBuilds`,
   `--no-lint`, `// eslint-disable`, `// @ts-ignore`, or similar escape hatches
   to pass CI/deploy is strictly forbidden. Fix the root cause. If a check is
   noisy, tune the rule threshold — don't disable the check.

## Deployment rule

After all work is complete, verified, and confirmed clean:

1. Ask the user: "¿Necesitas algo más o estamos listos para poner el site en live?"
2. Only push/deploy after the user confirms.

This prevents premature deployments — the user may have more changes to
batch together before going live.

### Pre-live checklist (mandatory before declaring "live")

When the user says "estamos listos para live" or similar, **verify all
platforms** and report status. Do not declare "live" until every item is
confirmed.

| # | Platform | What to check | How to verify |
|---|---|---|---|
| 1 | **GitHub** | All commits pushed to `main` | `git status` clean, `git log` matches remote |
| 2 | **Vercel** | Latest deploy succeeded | Check `x-vercel-cache` headers or GitHub commit status shows ✅ (not pending/failure) |
| 3 | **Supabase** | All migrations applied | Verify `supabase/migrations/` files were pushed via Supabase CLI or dashboard |
| 4 | **Build** | `next build` and `next lint` pass clean locally | Run both commands — zero errors |
| 5 | **Localhost** | Smoke test the critical flows | curl or browser test the main pages (landing, quote, booking) |

**If any platform is not ready**, tell the user exactly what's missing and
what action is needed (e.g., "Vercel build is pending — waiting for deploy",
"Supabase migration 366 needs `npx supabase db push`").

**Only when all 5 items are confirmed** can you say "el site está live."

## Quality standards

1. **Excelencia sin excepciones.** Todo debe quedar excelente y perfecto.
   Cero bugs, cero errores, cero warnings. Nada que impida que el sitio esté
   perfecto es aceptable.

2. **Verificación en localhost.** Antes de entregar cualquier cambio, revisar
   en localhost que la corrección tuvo efecto. Si no funcionó, arreglarlo
   hasta que quede perfecto y volver a ensayar en localhost.

3. **Ciclo hasta perfección.** El proceso no para hasta que no quede
   completamente excelente y perfecto. Repetir el ciclo de arreglar →
   verificar en localhost → arreglar tantas veces como sea necesario.
