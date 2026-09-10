// RFC 4180 CSV reader. Excel quotes any field holding a comma, quote or newline,
// and the DATA sheet has all three, so a split(',') reader would corrupt rows.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip Excel's BOM
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const push = () => { row.push(field); field = ''; };
  const endRow = () => { push(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { field += ch; i++; continue; }
      if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
      quoted = false; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { push(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// The import is only safe if the file really is sheet DATA A-U, so check the
// header against the Excel headers before a single row is written.
export function checkHeader(actual, expected) {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  if (actual.length !== expected.length)
    return `ไฟล์มี ${actual.length} คอลัมน์ แต่ชีต DATA คอลัมน์ A–U ต้องมี ${expected.length} คอลัมน์`;
  for (let i = 0; i < expected.length; i++) {
    if (clean(actual[i]) !== clean(expected[i]))
      return `หัวข้อคอลัมน์ที่ ${i + 1} ไม่ตรง: ไฟล์เป็น "${actual[i]}" แต่ชีต DATA เป็น "${expected[i]}"`;
  }
  return null;
}
