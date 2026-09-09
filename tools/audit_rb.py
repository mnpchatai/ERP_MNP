"""Read OOXML and VBA without Excel automation or macro execution.
Usage: python tools/audit_rb.py path ... ; output stays in ignored .private-rb.
"""
import sys, zipfile, json, hashlib, re
from pathlib import Path
from xml.etree import ElementTree as E
sys.path.insert(0, str(Path('.private-tools').resolve()))
from oletools.olevba import VBA_Parser
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
out=Path('.private-rb');out.mkdir(exist_ok=True)
for index,source in enumerate(sys.argv[1:]):
 dest=out/str(index);dest.mkdir(exist_ok=True)
 print('Inspecting',index,Path(source).name,flush=True)
 with zipfile.ZipFile(source) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(t.text or '' for t in s.iter('{'+N['s']+'}t')) for s in E.fromstring(z.read('xl/sharedStrings.xml'))]
  relations={r.attrib['Id']:r.attrib['Target'] for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  workbook=E.fromstring(z.read('xl/workbook.xml'))
  report={'source':str(source),'sheets':[],'names':[],'macros':[],'links':[]}
  for dn in workbook.findall('s:definedNames/s:definedName',N): report['names'].append([dn.attrib,dn.text])
  for sheet in workbook.findall('s:sheets/s:sheet',N):
   name=sheet.attrib['name'];target=relations[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
   target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   selected=name in ['(O.o)','Master_Rubber','DATA STANDARD','System','MAIN','DATA BOM','DATA','BOMSHEET','WIP-RBGR','ใบสั่งงานในแผนก','ป้ายชี้บ่ง']
   if not selected: continue
   record={'name':name,'cells':[]}
   with z.open(target) as stream:
    for _,cell in E.iterparse(stream,events=['end']):
     if cell.tag!='{'+N['s']+'}c':continue
     addr=cell.attrib['r'];row=int(re.search(r'\d+',addr)[0]);limit=80 if name in ['(O.o)','MAIN','ใบสั่งงานในแผนก','ป้ายชี้บ่ง'] else 12
     if row<=limit:
      v=cell.find('s:v',N);f=cell.find('s:f',N);value=v.text if v is not None else None
      if cell.attrib.get('t')=='s' and value is not None:value=strings[int(value)]
      if cell.attrib.get('t')=='inlineStr':value=''.join(t.text or '' for t in cell.findall('.//s:t',N))
      if value is not None or f is not None:record['cells'].append({'cell':addr,'value':value,'type':cell.attrib.get('t'),'formula':f.text if f is not None else None,'formulaAttributes':f.attrib if f is not None else None})
     cell.clear()
   report['sheets'].append(record)
  for n in z.namelist():
   if n.startswith('xl/externalLinks/_rels/'):report['links'].append(z.read(n).decode())
  if 'xl/vbaProject.bin' in z.namelist():
   raw=z.read('xl/vbaProject.bin');report['vba_sha256']=hashlib.sha256(raw).hexdigest()
   parser=VBA_Parser('vbaProject.bin',data=raw)
   for _,stream,filename,code in parser.extract_macros():
    filename=Path(filename).name
    (dest/filename).write_text(code,encoding='utf-8')
    report['macros'].append({'file':filename,'procedures':re.findall(r'(?im)^\s*(?:Public |Private )?(?:Sub|Function)\s+([^\r\n]+)',code)})
   parser.close()
  (dest/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  print('Saved',index,'sheets',len(report['sheets']),'VBA modules',len(report['macros']),flush=True)
