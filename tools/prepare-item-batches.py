import json
from pathlib import Path
root=Path('.private-rb/items');batch=[];size=0;index=0;total=0
for source in ['0.json','1.json']:
 for item in json.loads((root/source).read_text(encoding='utf8')):
  rows=[{'row':r['row'],'values':r['values'],'types':r['types']} for r in item['source_rows'] if r['values'].get('D')=='RB']
  compact={k:item[k] for k in ['source_hash','source_name','item_code','item_name','rb_count']}
  compact['rb_rows']=rows;compact['bom_row_count']=len(item['source_rows'])
  encoded=json.dumps(compact,ensure_ascii=False,separators=(',',':'))
  if size+len(encoded)>45000 and batch:
   (root/f'batch-{index}.json').write_text('['+','.join(batch)+']',encoding='utf8');index+=1;batch=[];size=0
  batch.append(encoded);size+=len(encoded);total+=1
if batch:(root/f'batch-{index}.json').write_text('['+','.join(batch)+']',encoding='utf8');index+=1
print(json.dumps({'items':total,'batches':index}))
