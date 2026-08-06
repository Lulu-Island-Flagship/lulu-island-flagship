fp = 'src/app/[locale]/employee/service/[orderId]/page.tsx'
with open(fp) as f: lines = f.readlines()
logs_block = lines[233:248]
del lines[233:248]
lines[183:183] = logs_block
with open(fp, 'w') as f: f.writelines(lines)
print('FIXED')
