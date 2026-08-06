"""Clean TDZ fix for service/[orderId]/page.tsx — no ContactInfoDisclosure damage."""
fp = 'src/app/[locale]/employee/service/[orderId]/page.tsx'
with open(fp) as f:
    lines = f.readlines()

# Step 1: Move loadLogs (lines 240-253, 0-indexed 239-252) above loadService
# loadLogs block: const loadLogs = useCallback... through }, [orderId]);
# Find the exact range
logs_start = logs_end = None
for i, l in enumerate(lines):
    if 'const loadLogs = useCallback' in l:
        logs_start = i
        break
if logs_start:
    brace = 0
    for j in range(logs_start, len(lines)):
        brace += lines[j].count('{') - lines[j].count('}')
        if brace == 0 and j > logs_start:
            logs_end = j
            break
if logs_start and logs_end:
    logs_block = lines[logs_start:logs_end+1]
    del lines[logs_start:logs_end+1]
    # Insert before loadConfirmedColors
    target = None
    for i, l in enumerate(lines):
        if 'const loadConfirmedColors = useCallback' in l:
            target = i
            break
    if target:
        lines[target:target] = logs_block + ['\n']
        print(f'Moved loadLogs (was {logs_start+1}-{logs_end+1}, now before line {target+1})')

# Step 2: Move the useEffect at original ~line 178 below loadService
# Find useEffect that calls loadService/loadConfirmedColors
ue_start = ue_end = None
for i, l in enumerate(lines):
    if 'useEffect' in l and 'loadService' in lines[i+1] if i+1 < len(lines) else False:
        ue_start = i
    if ue_start is not None and ue_end is None:
        if 'loadConfirmedColors' in l and '],' in l:
            ue_end = i + 1
            break
# Fallback if not found exactly
if ue_start is None:
    for i, l in enumerate(lines):
        s = l.strip()
        if 'useEffect(() => {' in s:
            # Check next few lines for loadService
            for k in range(i+1, min(i+6, len(lines))):
                if 'loadService()' in lines[k]:
                    ue_start = i
                    break
        if ue_start is not None:
            for j in range(ue_start, min(ue_start+10, len(lines))):
                if 'loadConfirmedColors' in lines[j] and '],' in lines[j]:
                    ue_end = j + 1
                    break
            break

if ue_start is not None and ue_end is not None:
    ue_block = lines[ue_start:ue_end]
    
    # Find loadService end to insert after it
    svc_end = None
    for i, l in enumerate(lines):
        if 'const loadService = useCallback' in l:
            brace = 0
            for j in range(i, len(lines)):
                brace += lines[j].count('{') - lines[j].count('}')
                if brace == 0 and j > i:
                    svc_end = j
                    break
            break
    
    if svc_end:
        # Remove the useEffect
        del lines[ue_start:ue_end]
        # Recalculate svc_end position after deletion
        svc_end -= (ue_end - ue_start)
        # Insert useEffect after loadService
        lines[svc_end+1:svc_end+1] = ['\n'] + ue_block
        print(f'Moved useEffect (was {ue_start+1}-{ue_end+1}, now after loadService at {svc_end+1})')

with open(fp, 'w') as f:
    f.writelines(lines)
print('DONE — clean fix applied')
