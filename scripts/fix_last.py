fp = 'src/app/[locale]/employee/service/[orderId]/page.tsx'
with open(fp) as f:
    lines = f.readlines()

# Find: "    }\n  const loadConfirmedColors = useCallback"
# Insert: "  }, [orderId]);\n" between them
for i, l in enumerate(lines):
    if l.rstrip() == '    }' and i+1 < len(lines) and 'const loadConfirmedColors = useCallback' in lines[i+1]:
        lines.insert(i+1, '  }, [orderId]);\n')
        break

with open(fp, 'w') as f:
    f.writelines(lines)
print('FIXED')
