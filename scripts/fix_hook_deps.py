#!/usr/bin/env python3
"""Fix react-hooks/exhaustive-deps warnings by wrapping load functions in useCallback."""
import re, os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# (filepath, function_name, dependencies_string)
FILES = [
    # Simple: load functions with just t
    ("src/components/admin/AdminServiciosClient.tsx", "loadServices", "t"),
    ("src/components/admin/AdminPricingSettingsClient.tsx", "loadSettings", "t"),
    ("src/components/cuenta/PerfilClient.tsx", "load", "tCommon"),
    ("src/app/[locale]/account/services/[orderId]/tracking/page.tsx", "load", "orderId, t"),
    ("src/app/[locale]/employee/keys/[orderId]/page.tsx", "load", "orderId"),
    ("src/app/[locale]/admin/applicants/page.tsx", "loadApplicants", "t, statusFilter, page"),
    ("src/components/admin/AdminServicioDetailClient.tsx", "loadChecklist", "orderId, t"),
    ("src/app/[locale]/employee/breaks/page.tsx", "load", "t"),
]

for fp, fn, dep in FILES:
    try:
        with open(fp) as f:
            c = f.read()
    except FileNotFoundError:
        print(f"SKIP: {fp}")
        continue

    # Add useCallback to React import if missing
    if "useCallback" not in c.split("import React")[1].split("from")[0] if "import React" in c else True:
        c = re.sub(r'(import React,\s*\{)', r'\1useCallback, ', c)

    # Step 1: async function fn() { -> const fn = useCallback(async () => {
    c = c.replace(f"async function {fn}() {{", f"const {fn} = useCallback(async () => {{")

    # Step 2: Find matching closing brace and add }, [dep]);
    idx = c.find(f"const {fn} = useCallback(async () => {{")
    if idx >= 0:
        depth = 0
        end = idx
        for i, ch in enumerate(c[idx:], idx):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        c = c[:end] + f"}}, [{dep}]);" + c[end + 1 :]

    # Step 3: useEffect(() => { fn(); }, [...]) -> useEffect(() => { fn(); }, [fn])
    # Handle multiline
    c = re.sub(
        rf"useEffect\(\(\) => \{{\s*\n\s*{fn}\(\);\s*\n\s*\}}, \[\]\)",
        f"useEffect(() => {{ {fn}(); }}, [{fn}])",
        c,
    )
    # Handle single-line with empty deps
    old = f"useEffect(() => {{ {fn}(); }}, [])"
    new = f"useEffect(() => {{ {fn}(); }}, [{fn}])"
    c = c.replace(old, new)
    # Handle single-line with existing deps
    old2 = f"useEffect(() => {{ {fn}(); }}, "
    if old2 in c:
        c = re.sub(rf"useEffect\(\(\) => \{{\s*{fn}\(\);\s*\}}, \[([^\]]*)\]\)", 
                   f"useEffect(() => {{ {fn}(); }}, [{fn}]", c)

    with open(fp, "w") as f:
        f.write(c)
    print(f"OK: {fp}")

# Handle AdminPricingSettingsClient second function: loadHHE
fp = "src/components/admin/AdminPricingSettingsClient.tsx"
try:
    with open(fp) as f:
        c = f.read()
    fn = "loadHHE"
    c = c.replace(f"async function {fn}() {{", f"const {fn} = useCallback(async () => {{")
    idx = c.find(f"const {fn} = useCallback(async () => {{")
    if idx >= 0:
        depth = 0; end = idx
        for i, ch in enumerate(c[idx:], idx):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0: end = i; break
        c = c[:end] + "}, [t]);" + c[end + 1 :]
    # Update useEffect deps to include both loadSettings and loadHHE
    c = re.sub(
        r"useEffect\(\(\) => \{\s*\n\s*loadSettings\(\);\s*\n\s*loadHHE\(\);\s*\n\s*\}, \[\]\)",
        "useEffect(() => { loadSettings(); loadHHE(); }, [loadSettings, loadHHE])",
        c,
    )
    with open(fp, "w") as f:
        f.write(c)
    print(f"OK (HHE): {fp}")
except Exception as e:
    print(f"ERR (HHE): {e}")

print("DONE")
