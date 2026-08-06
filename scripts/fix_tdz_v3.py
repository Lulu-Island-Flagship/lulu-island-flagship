"""Fix TDZ errors: useEffect calling load*() before const load* = useCallback."""
import re

with open('scripts/tdz_files.txt') as f:
    files = [l.strip() for l in f if l.strip()]

for fp in files:
    with open(fp) as f:
        text = f.read()

    # Find: useEffect(() => { ...anything... }, [..., FNAME, ...]);
    # followed by: const FNAME = useCallback
    # Swap them: const... first, then useEffect
    
    m = re.search(
        r'(  useEffect\(\s*\(\)\s*=>\s*\{[^}]*\},\s*\[([^\]]*)\]\);)'
        r'\s*\n\s*\n'
        r'(  (?:const|async function)\s+(\w*load\w*)\b)',
        text, re.DOTALL
    )
    
    if not m:
        print(f"NO MATCH: {fp}")
        continue
    
    ue_block = m.group(1)      # useEffect block
    ue_deps = m.group(2)       # dependency list like "load"
    fn_start = m.group(3)      # "const load" or "async function loadData"
    fn_name = m.group(4)       # function name
    fn_start_pos = m.start(3)  # position of "const load"

    # Quick check: the useEffect must be calling the function defined below
    if fn_name not in ue_deps:
        print(f"SKIP (name mismatch): {fp} ue_deps={ue_deps} fn_name={fn_name}")
        continue

    # Find the end of the function declaration
    # For useCallback: ends with });
    # For async function: ends with }
    after_fn = text[fn_start_pos:]
    brace_count = 0
    fn_end_pos = fn_start_pos
    in_fn = False
    for i, ch in enumerate(after_fn):
        if not in_fn:
            in_fn = True
        if ch == '{':
            brace_count += 1
        elif ch == '}':
            brace_count -= 1
            if brace_count == 0:
                # Check if this is the closing of useCallback });
                if 'useCallback' in after_fn[:i]:
                    # find the next );
                    remaining = after_fn[i:]
                    j = remaining.find(');')
                    if j >= 0:
                        fn_end_pos = fn_start_pos + i + j + 2
                        break
                else:
                    # async function — just the closing brace
                    fn_end_pos = fn_start_pos + i + 1
                    break
    
    fn_block = text[fn_start_pos:fn_end_pos]
    ue_start = m.start(1)
    ue_end = m.end(1)

    # Reconstruct: fn_block first, then blank line, then ue_block
    new_text = (
        text[:ue_start] 
        + fn_block 
        + '\n\n' 
        + ue_block 
        + text[fn_end_pos:]
    )
    
    with open(fp, 'w') as f:
        f.write(new_text)
    print(f"FIXED: {fp}")
