"""Fix all remaining TDZ errors. Final, minimal, direct."""
import os

# List of (filepath, old_text, new_text) tuples
fixes = [
    (
        'src/components/cuenta/PerfilClient.tsx',
        '  useEffect(() => { load(); }, [load]);\n\n  const load = useCallback(async () => {',
        '  const load = useCallback(async () => {\n\n  useEffect(() => { load(); }, [load]);'
    ),
    (
        'src/app/[locale]/employee/voting/page.tsx',
        '    loadPeers();\n\n  const loadPeers = useCallback',
        '  useEffect(() => { loadPeers(); }, [loadPeers]);\n\n  const loadPeers = useCallback'
    ),
    (
        'src/components/admin/AdminPricingSettingsClient.tsx',
        '  useEffect(() => {\n    loadSettings();\n    loadHHE();\n  }, [loadSettings, loadHHE]);\n\n  const loadSettings = useCallback',
        '  const loadSettings = useCallback'
    ),
    (
        'src/components/admin/AdminServicioDetailClient.tsx',
        '  useEffect(() => {\n    if (!orderId) return;\n    loadChecklist();\n  }, [loadChecklist, orderId]);\n\n  const loadChecklist = useCallback',
        '  const loadChecklist = useCallback'
    ),
    (
        'src/components/admin/AdminChecklistsClient.tsx',
        '  useEffect(() => {\n    loadChecklists();\n  }, [loadChecklists]);\n\n  // Close zone menu when clicking outside',
        '  const loadChecklists = useCallback'
    ),
    (
        'src/components/admin/AdminServiciosClient.tsx',
        '  useEffect(() => {\n    loadServices();\n    loadEmployees();\n  }, [loadServices]);\n\n  const loadServices = useCallback',
        '  const loadServices = useCallback'
    ),
    (
        'src/app/[locale]/employee/service/[orderId]/page.tsx',
        '  useEffect(() => {\n    if (!orderId) return;\n    loadService();\n    loadConfirmedColors();\n  }, [loadService, loadConfirmedColors, orderId]);\n\n  // v8.3 E4 fix',
        '  // v8.3 E4 fix'
    ),
]

for fp, old, new in fixes:
    with open(fp) as f:
        content = f.read()
    if old in content:
        content = content.replace(old, new, 1)
        with open(fp, 'w') as f:
            f.write(content)
        print(f'FIX: {fp}')
    else:
        print(f'NOMATCH: {fp}')
