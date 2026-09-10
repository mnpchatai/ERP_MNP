"""Read DATA A:U without executing VBA or recalculating; private JSON output only."""
import sys,json,hashlib,zipfile,re,io
from pathlib import Path
from xml.etree import ElementTree as ET
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
dest=Path('.private-rb/items');dest.mkdir(parents=True,exist_ok=True)
for index,name in enumerate(sys.argv[1:]):
 source=Path(name);blob=source.read_bytes();sha=hashlib.sha256(blob).hexdigest()
 with zipfile.ZipFile(io.BytesIO(blob)) as z:
  strings=[''.join(t.text or '' for t in si.findall('.//s:t',NS)) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
  rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  book=ET.fromstring(z.read('xl/workbook.xml'))
  sheet=next(s for s in book.findall('s:sheets/s:sheet',NS) if s.attrib['name']=='DATA')
  target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
  target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
  groups={};headers={};errors=0
  for _,row in ET.iterparse(z.open(target),events=['end']):
   if row.tag!='{'+NS['s']+'}row':continue
   number=int(row.attrib['r']);values={};formulas={};types={}
   for c in row.findall('s:c',NS):
    col=re.sub(r'\d','',c.attrib['r'])
    if len(col)>1 or col>'U':continue
    v=c.find('s:v',NS);f=c.find('s:f',NS);value=v.text if v is not None else None
    typ=c.attrib.get('t','n')
    if typ=='s' and value is not None:value=strings[int(value)]
    if typ=='inlineStr':value=''.join(t.text or '' for t in c.findall('.//s:t',NS))
    if value is not None:values[col]=value
    if f is not None:formulas[col]={'text':f.text,'attributes':f.attrib}
    if typ=='e':errors+=1
    if typ!='n':types[col]=typ
   if number==2:headers=values
   if number>2 and values.get('A'):
    groups.setdefault(values['A'],[]).append({'row':number,'values':values,'formulas':formulas,'types':types})
   row.clear()
  items=[]
  for code,rows in groups.items():
   rb=[r for r in rows if r['values'].get('D')=='RB']
   if not rb:continue
   title=next((r['values'].get('K') for r in rows if r['values'].get('C')==code and r['values'].get('K')),code)
   items.append({'source_hash':sha,'item_code':code,'item_name':title,'source_name':source.name,'rb_count':len(rb),'source_rows':rows,'headers':headers})
  (dest/f'{index}.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')),encoding='utf8')
  print(json.dumps({'source':index,'items_with_rb':len(items),'rows':sum(len(i['source_rows']) for i in items),'error_cells_in_data':errors,'bytes':(dest/f'{index}.json').stat().st_size}))
