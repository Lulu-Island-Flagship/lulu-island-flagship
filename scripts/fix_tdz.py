import sys, os

# Fix pattern: useEffect calling load() before const load = useCallback
# Swap the two blocks

for filepath in sys.argv[1:]:
    with open(filepath) as f:
        lines = f.readlines()

    modified = False
    new_lines = []
    skip_next = 0

    for i, line in enumerate(lines):
        if skip_next > 0:
            skip_next -= 1
            continue

        # Pattern: "  useEffect(() => {" followed by "    load();" followed by "  }, [load]);"
        # followed by empty line followed by "  const load = useCallback(async () => {"
        if ('useEffect(() => {' in line and 'load' in line and
            i + 7 < len(lines)):
            
            # Check if the next lines match the pattern
            next_lines = ''.join(lines[i:i+5])
            if 'load()' in next_lines and '}, [load]' in next_lines and 'const load = useCallback' in ''.join(lines[i+3:i+8]):
                # Find the end of the useCallback block
                cb_start = -1
                ue_end = -1
                cb_end = -1
                
                for j in range(i, min(i+8, len(lines))):
                    if '}, [load]);' in lines[j]:
                        ue_end = j
                    if 'const load = useCallback' in lines[j]:
                        cb_start = j
                
                if ue_end >= 0 and cb_start >= 0 and cb_start > ue_end:
                    # Find end of useCallback: find the matching closing brace + comma + deps
                    brace_count = 0
                    in_cb = False
                    for j in range(cb_start, len(lines)):
                        if 'const load = useCallback' in lines[j]:
                            in_cb = True
                        if in_cb:
                            brace_count += lines[j].count('{') - lines[j].count('}')
                            if brace_count == 0 and ('});' in lines[j] or ');' in lines[j]):
                                cb_end = j
                                break
                    
                    if cb_end >= 0:
                        # Get the useEffect block (including the blank line after it)
                        ue_block = lines[i:ue_end+2]  # +2 for }, [load]); and blank line
                        # Get the useCallback block
                        cb_block = lines[cb_start:cb_end+1]
                        
                        # Output: useCallback first, then useEffect
                        new_lines.extend(cb_block)
                        new_lines.append('\n')
                        new_lines.extend(ue_block)
                        skip_next = cb_end - i
                        modified = True
                        continue

        new_lines.append(line)

    if modified:
        with open(filepath, 'w') as f:
            f.writelines(new_lines)
        print(f"Fixed: {filepath}")
    else:
        print(f"Skipped: {filepath}")
