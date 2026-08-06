"""Fix TDZ by line-by-line swap. Impossible to fail on simple pattern."""
import sys

for fp in sys.argv[1:]:
    with open(fp) as f:
        lines = f.readlines()

    # Find the pattern:
    #   useEffect(() => {
    #     loadNAME();
    #   }, [loadNAME]);
    #   (blank line)
    #   const loadNAME = useCallback...
    # 
    # Or:
    #   useEffect(() => {
    #     loadNAME();
    #   }, [loadNAME]);
    #   (blank line)
    #   async function loadNAME...

    fixed = False
    for i in range(len(lines) - 6):
        l0 = lines[i].strip()
        l1 = lines[i+1].strip()
        l2 = lines[i+2].strip()
        l3 = lines[i+3].strip()
        l4 = lines[i+4].strip()
        
        # Match useEffect(() => {
        if not ('useEffect(() => {' in l0):
            continue
        
        # Match load*() call
        if not (l1.endswith('();') and 'load' in l1.lower()):
            continue
            
        # Match }, [load*]);
        if not (l2.startswith('}, [') and 'load' in l2.lower() and l2.endswith(']);')):
            continue
        
        # Match blank line
        if l3 != '':
            continue
        
        # Match const load* = useCallback or async function load*
        is_const = 'const ' in l4 and 'useCallback' in l4 and 'load' in l4.lower()
        is_async = l4.startswith('async function') and 'load' in l4.lower()
        if not (is_const or is_async):
            continue
        
        # Extract the function name from useEffect deps
        import re
        deps = re.search(r'\[([^\]]*)\]', l2)
        if not deps:
            continue
        dep_name = deps.group(1).strip()
        if dep_name.lower() not in l1.lower():
            continue
        
        # We found the pattern. Now find the function end.
        fn_start = i + 4
        fn_end = fn_start
        brace_count = 0
        started = False
        for j in range(fn_start, len(lines)):
            line = lines[j]
            if not started:
                started = True
            brace_count += line.count('{') - line.count('}')
            if started and brace_count == 0:
                # For useCallback, need to also match });
                if is_const and ');' in line:
                    fn_end = j
                    break
                elif is_async:
                    fn_end = j
                    break
            # handle useCallback closing on a separate line
            if is_const and brace_count <= 0 and ('});' in line or ');' in line):
                fn_end = j
                break
        
        if fn_end <= fn_start:
            continue
        
        # Extract blocks
        ue_block = lines[i:i+4]  # useEffect + load() + }, [load]); + blank
        fn_block = lines[fn_start:fn_end+1]
        
        # Rebuild: remove both, insert fn_block first, then ue_block
        new_lines = lines[:i] + fn_block + ['\n'] + ue_block + lines[fn_end+1:]
        lines = new_lines
        fixed = True
        break  # Only fix first occurrence per file

    if fixed:
        with open(fp, 'w') as f:
            f.writelines(lines)
        print(f"FIXED: {fp}")
    else:
        print(f"NO PATTERN: {fp}")
