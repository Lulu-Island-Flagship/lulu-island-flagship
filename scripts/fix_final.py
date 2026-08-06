"""Fix TDZ: swap useEffect before useCallback. Final version."""
files = [
    'src/app/[locale]/account/wallet/page.tsx',
    'src/app/[locale]/account/services/[orderId]/gallery/page.tsx',
    'src/app/[locale]/account/services/[orderId]/tracking/page.tsx',
    'src/app/[locale]/account/services/[orderId]/invoice/InvoicePageClient.tsx',
    'src/app/[locale]/employee/keys/[orderId]/page.tsx',
]

for fp in files:
    with open(fp) as f:
        lines = f.readlines()

    # Step 1: find useEffect that contains load
    ue_start = None
    ue_end = None
    for i, l in enumerate(lines):
        s = l.strip()
        if ue_start is None and 'useEffect(' in s:
            ue_start = i
        if ue_start is not None and ue_end is None:
            if 'load' in s and ('});' in s or ']);' in s):
                ue_end = i + 1
                break
            # also catch multi-line useEffect ending
            if ue_start < i and (s == '});' or s == ']);'):
                ue_end = i + 1
                break

    if ue_start is None or ue_end is None:
        # Try broader: find any useEffect, then check if any line in range has load
        for i, l in enumerate(lines):
            if 'useEffect(' in l.strip():
                for j in range(i, min(i+20, len(lines))):
                    if 'load' in lines[j] and ('});' in lines[j] or ']);' in lines[j]):
                        ue_start = i
                        ue_end = j + 1
                        break
                if ue_start is not None:
                    break

    if ue_start is None or ue_end is None:
        print(f'SKIP {fp}: ue_s={ue_start} ue_e={ue_end}')
        continue

    # Step 2: find const load = useCallback after ue_end
    fn_start = None
    fn_end = None
    for i in range(ue_end, len(lines)):
        s = lines[i].strip()
        if fn_start is None and 'const ' in s and 'load' in s and 'useCallback' in s:
            fn_start = i
        if fn_start is not None:
            # Track braces to find end
            brace = 0
            found_open = False
            for j in range(fn_start, len(lines)):
                l = lines[j]
                brace += l.count('{') - l.count('}')
                if '{' in l:
                    found_open = True
                if found_open and brace == 0:
                    # Check for closing ); or });
                    if ');' in l or '});' in l:
                        fn_end = j
                        break
            break

    if fn_start is None or fn_end is None:
        print(f'SKIP {fp}: fn_s={fn_start} fn_e={fn_end}')
        continue

    # Extract and swap
    ue_block = lines[ue_start:ue_end]
    fn_block = lines[fn_start:fn_end + 1]
    
    new_lines = lines[:ue_start] + lines[ue_end:fn_start] + fn_block + ['\n'] + ue_block + lines[fn_end + 1:]
    
    with open(fp, 'w') as f:
        f.writelines(new_lines)
    print(f'FIXED {fp} (ue={ue_start}-{ue_end}, fn={fn_start}-{fn_end})')
