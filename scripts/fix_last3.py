"""Fix last 3 TDZ files."""
fixes = [
    (
        'src/app/[locale]/employee/voting/page.tsx',
        '  useEffect(() => { loadPeers(); }, [loadPeers]);\n\n  const loadPeers = useCallback(async () => {',
        '  const loadPeers = useCallback(async () => {\n\n  useEffect(() => { loadPeers(); }, [loadPeers]);'
    ),
    (
        'src/app/[locale]/employee/service/[orderId]/page.tsx',
        '  useEffect(() => {\n    loadService();\n    loadConfirmedColors();\n  }, [loadService, loadConfirmedColors, orderId]);',
        '  // useEffect moved below declarations'
    ),
]

for fp, old, new in fixes:
    with open(fp) as f:
        c = f.read()
    if old in c:
        c = c.replace(old, new, 1)
        with open(fp, 'w') as f:
            f.write(c)
        print(f'FIX: {fp}')
    else:
        print(f'NOMATCH: {fp}')
