import csv, json, sys
from pathlib import Path

src = Path(sys.argv[1]); import_id = sys.argv[2]; out = Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
batch_size = int(sys.argv[4]) if len(sys.argv) > 4 else 40
with src.open(encoding='utf8', newline='') as f:
    rows=[]
    for r in csv.DictReader(f):
        rows.append({
            'import_id':import_id, 'owner_id':r['owner_id'], 'sheet_name':r['sheet_name'],
            'row_number':int(r['row_number']), 'item_code':r['item_code'] or None,
            'component_code':r['component_code'] or None, 'department':r['department'] or None,
            'cell_values':json.loads(r['cell_values']), 'cell_formulas':json.loads(r['cell_formulas']),
            'cell_types':json.loads(r['cell_types']), 'row_hash':r['row_hash']
        })
for i in range(0,len(rows),batch_size):
    (out/f'batch-{i//batch_size:04d}.json').write_text(json.dumps(rows[i:i+batch_size],ensure_ascii=False,separators=(',',':')),encoding='utf8')
print(json.dumps({'rows':len(rows),'batches':(len(rows)+batch_size-1)//batch_size,'directory':str(out),'batch_size':batch_size}))
