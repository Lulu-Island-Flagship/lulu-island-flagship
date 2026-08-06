"""Move ContactInfoDisclosure above ServicioPage to fix TS1005 errors."""
fp = 'src/app/[locale]/employee/service/[orderId]/page.tsx'
with open(fp) as f:
    lines = f.readlines()

# Find the function (starts at line 1267, 0-indexed 1266)
fn_start = None
fn_end = None
for i, l in enumerate(lines):
    if 'function ContactInfoDisclosure' in l:
        fn_start = i
    if fn_start is not None and i > fn_start and l.rstrip() == '}' and lines[i-1].strip() == ');':
        fn_end = i
        break

if fn_start is None or fn_end is None:
    # Fallback: find by tracking braces
    for i, l in enumerate(lines):
        if 'function ContactInfoDisclosure' in l:
            fn_start = i
            brace = 0
            for j in range(i, len(lines)):
                brace += lines[j].count('{') - lines[j].count('}')
                if brace == 0 and j > i:
                    fn_end = j
                    break
            break

print(f'ContactInfoDisclosure: lines {fn_start+1}-{fn_end+1}')

# Find export default function ServicioPage (line 56, 0-indexed 55)
svc_start = None
for i, l in enumerate(lines):
    if 'export default function ServicioPage' in l:
        svc_start = i
        break

print(f'ServicioPage starts at line {svc_start+1}')

# Extract and move
fn_block = lines[fn_start:fn_end+1]
# Remove comment block above it too (lines 1259-1265, 0-indexed 1258-1264)
comment_start = fn_start
while comment_start > 0 and (lines[comment_start-1].strip().startswith('*') or lines[comment_start-1].strip().startswith('/**') or lines[comment_start-1].strip() == ''):
    comment_start -= 1
# Include the /** line
if comment_start > 0 and '/**' in lines[comment_start-1]:
    comment_start -= 1

full_block = lines[comment_start:fn_end+1]
del lines[comment_start:fn_end+1]

# Insert before ServicioPage (at svc_start = line 56 = index 55)
# But need to insert before it with blank line separator
lines.insert(svc_start, '\n')
lines.insert(svc_start, ''.join(full_block))

with open(fp, 'w') as f:
    f.writelines(lines)
print('MOVED — ContactInfoDisclosure now above ServicioPage')
