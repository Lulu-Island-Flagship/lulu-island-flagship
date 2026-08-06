import sys, re

for filepath in sys.argv[1:]:
    with open(filepath) as f:
        content = f.read()
    
    original = content
    
    # Pattern: useEffect(() => { ... loadNAME(); ... }, [..., loadNAME, ...]);\n\n  const loadNAME = useCallback...
    # We need to swap them: const loadNAME = useCallback... FIRST, then useEffect
    
    # Find all useEffect blocks that reference load-functions
    # Pattern captures: the entire useEffect block + the function declaration that follows
    
    pattern = re.compile(
        r'(  useEffect\(\s*\(\)\s*=>\s*\{[^}]*\}|\s*\[[^\]]*\]\s*\)\s*;)\s*\n\s*\n(  (?:const|async function)\s+\w*load\w*[^;{]*[\s\S]*?(?=\n  \w|\n\s*\n  (?!const|async|\}))',
        re.DOTALL
    )
    
    def replacer(match):
        ue_block = match.group(1)  # the useEffect block
        rest = match.group(2)      # the function declaration
        
        # Find the closing of the function declaration
        # For const f = useCallback(...) the pattern ends with });
        # For async function f() { ... } it ends with }
        
        # Split: find first complete function declaration
        lines = rest.split('\n')
        fn_lines = []
        brace_count = 0
        in_fn = False
        for line in lines:
            fn_lines.append(line)
            if 'const' in line and 'useCallback' in line:
                in_fn = True
            elif 'async function' in line:
                in_fn = True
            if in_fn:
                brace_count += line.count('{') - line.count('}')
                if brace_count == 0 and ('});' in line or (line.strip() == '}' and fn_lines)):
                    break
        
        fn_block = '\n'.join(fn_lines)
        remaining = rest[len(fn_block):] if len(fn_block) < len(rest) else ''
        
        return fn_block + '\n\n' + ue_block + '\n' + remaining
    
    content = pattern.sub(replacer, content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed: {filepath}")
    else:
        print(f"Skipped: {filepath}")
