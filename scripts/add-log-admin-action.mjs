// Script de migración masiva: agrega logAdminAction a route handlers
// que usan requireAdminRole en POST/PATCH/PUT/DELETE pero no llaman logAdminAction.
//
// Uso: node scripts/add-log-admin-action.mjs

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// Encontrar archivos que necesitan la migración
const result = execSync(
  `grep -rl "requireAdminRole" src/app --include="*.ts" | xargs grep -L "logAdminAction" | xargs grep -l "export async function POST\\|export async function PATCH\\|export async function PUT\\|export async function DELETE"`,
  { encoding: "utf-8" }
);

const files = result.trim().split("\n").filter(Boolean);
console.log(`Encontrados ${files.length} archivos para migrar`);

let updated = 0;
let skipped = 0;

for (const file of files) {
  let content = readFileSync(file, "utf-8");

  // Saltar si ya tiene logAdminAction (doble check)
  if (content.includes("logAdminAction")) { skipped++; continue; }

  // Extraer el nombre del recurso del primer argumento de requireAdminRole
  const authCallMatch = content.match(/requireAdminRole\("([^"]+)"(?:,\s*\{[^}]*\})?\)/);
  if (!authCallMatch) { skipped++; continue; }
  const resource = authCallMatch[1];

  // Agregar logAdminAction al import
  if (content.includes('import { requireAdminRole }')) {
    content = content.replace(
      'import { requireAdminRole }',
      'import { requireAdminRole, logAdminAction }'
    );
  } else if (content.includes('import { requireAdminRole,')) {
    // Ya tiene más imports además de requireAdminRole
    if (!content.includes('logAdminAction')) {
      content = content.replace(
        /import \{ requireAdminRole,/,
        'import { requireAdminRole, logAdminAction,'
      );
    }
  }

  // Insertar el bloque logAdminAction después del chequeo de auth.error
  // Buscar el patrón: "if (auth.error" ... "return NextResponse..."
  // e insertar después de ese bloque
  const authCheckRegex = /(if\s*\(auth\.error[\s\S]*?return\s+NextResponse\.json\(\{[\s\S]*?\}\)\s*;?\s*\)?\s*)\n/;
  const authCheckMatch = content.match(authCheckRegex);

  if (authCheckMatch) {
    const authBlock = authCheckMatch[1];
    const logBlock = `
  if (!auth.supabase || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "${resource}", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
`;

    content = content.replace(
      authCheckRegex,
      authBlock + logBlock + "\n"
    );
    updated++;
  } else {
    console.log(`  ⚠️  No se encontró patrón de auth check en ${file}`);
    skipped++;
    continue;
  }

  writeFileSync(file, content, "utf-8");
}

console.log(`Actualizados: ${updated}, Saltados: ${skipped}`);
