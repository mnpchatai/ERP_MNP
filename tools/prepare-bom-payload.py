import csv,json,sys
from pathlib import Path
out=Path(sys.argv[1]); rows=[]
for filename in sys.argv[2:]:
  with Path(filename).open(encoding='utf8',newline='') as f:
    for r in csv.DictReader(f):
      rows.append({'sheet_name':r['sheet_name'],'row_number':int(r['row_number']),'item_code':r['item_code'] or None,'component_code':r['component_code'] or None,'department':r['department'] or None,'cell_values':json.loads(r['cell_values']),'cell_formulas':json.loads(r['cell_formulas']),'cell_types':json.loads(r['cell_types']),'row_hash':r['row_hash']})
out.write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print(json.dumps({'rows':len(rows),'bytes':out.stat().st_size,'path':str(out)}))
