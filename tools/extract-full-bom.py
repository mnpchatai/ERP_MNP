"""Read every non-empty worksheet row and preserve cell values/formulas/types.
Private import staging only. Does not execute VBA, formulas, or modify the workbook.
"""
import csv, hashlib, io, json, posixpath, re, sys, zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

source = Path(sys.argv[1])
blob = source.read_bytes()
sha = hashlib.sha256(blob).hexdigest()
dest = Path('.private-rb') / ('full-bom-' + sha[:16])
dest.mkdir(parents=True, exist_ok=True)
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
celltag = '{' + ns['s'] + '}'
owner = '1d736336-db97-42e1-af9f-4e7a9ca65afa'
compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
summary = {'source_name': source.name, 'source_hash': sha, 'source_bytes': len(blob), 'sheets': []}

with zipfile.ZipFile(io.BytesIO(blob)) as archive:
    names = set(archive.namelist())
    strings = []
    if 'xl/sharedStrings.xml' in names:
        root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        strings = [''.join(t.text or '' for t in si.findall('.//s:t', ns)) for si in root]
    relroot = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    rels = {r.attrib['Id']: r.attrib['Target'] for r in relroot}
    book = ET.fromstring(archive.read('xl/workbook.xml'))
    for sheet in book.findall('s:sheets/s:sheet', ns):
        sheet_name = sheet.attrib['name']
        target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
        counts = Counter(); departments = Counter(); items = set(); maxcol = 0
        csvpath = dest / (sheet_name + '.csv')
        with csvpath.open('w', encoding='utf-8', newline='') as out:
            writer = csv.writer(out)
            writer.writerow(['owner_id','source_hash','sheet_name','row_number','item_code','component_code','department','cell_values','cell_formulas','cell_types','row_hash'])
            with archive.open(target) as xml:
                for _, row in ET.iterparse(xml, events=['end']):
                    if row.tag != celltag + 'row':
                        continue
                    number = int(row.attrib['r']); values = {}; formulas = {}; types = {}
                    for cell in row.findall('s:c', ns):
                        col = re.sub(r'\d', '', cell.attrib['r'])
                        v = cell.find('s:v', ns); f = cell.find('s:f', ns)
                        value = v.text if v is not None else None
                        typ = cell.attrib.get('t', 'n')
                        if typ == 's' and value is not None:
                            value = strings[int(value)]
                        elif typ == 'inlineStr':
                            value = ''.join(t.text or '' for t in cell.findall('.//s:t', ns))
                        if value is not None:
                            values[col] = value
                        if f is not None:
                            formulas[col] = {'text': f.text, 'attributes': f.attrib}
                        if value is not None or f is not None:
                            counts['cells'] += 1
                            if typ != 'n':
                                types[col] = typ
                            n = 0
                            for ch in col:
                                n = n * 26 + ord(ch) - 64
                            maxcol = max(maxcol, n)
                        if typ == 'e':
                            counts['error_cells'] += 1
                    row.clear()
                    if not values and not formulas:
                        continue
                    counts['rows'] += 1
                    counts['formula_cells'] += len(formulas)
                    if number > 2:
                        counts['data_rows'] += 1
                        item = values.get('A', '')
                        department = values.get('D', '')
                        if item:
                            items.add(item)
                        else:
                            counts['rows_without_item'] += 1
                        departments[department] += 1
                    else:
                        item = ''; department = ''
                    component = values.get('C', '') if number > 2 else ''
                    packed = compact([number, values, formulas, types])
                    row_hash = hashlib.sha256(packed.encode()).hexdigest()
                    writer.writerow([owner, sha, sheet_name, number, item, component, department, compact(values), compact(formulas), compact(types), row_hash])
        summary['sheets'].append({'name': sheet_name, **counts, 'items': len(items), 'departments': dict(departments), 'max_column_number': maxcol, 'csv_bytes': csvpath.stat().st_size})
(dest / 'manifest.json').write_text(compact(summary), encoding='utf-8')
print(compact({'directory': str(dest), **summary}))
