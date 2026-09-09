// Compare local private audit caches; never print product names or quantities.
import fs from 'node:fs';
import {calculateExcelRow} from '../rb-excel.mjs';
let failed = false;
for (const file of process.argv.slice(2)) {
  const audit = JSON.parse(fs.readFileSync(file,'utf8'));
  const sheet = audit.sheets.find(s => s.name === '(O.o)');
  if (!sheet) throw new Error('Required calculation sheet missing');
  const row = Object.fromEntries(sheet.cells.filter(c => /^[A-Z]+8$/.test(c.cell)).map(c => [c.cell.replace('8',''),c]));
  const inputs = {};
  for (const key of ['G','H','J','K','M','S','U','V']) {
    const cell = row[key];
    if (!cell || cell.value === null || cell.type === 'e') throw new Error(`Unresolved input ${key}8`);
    inputs[key] = Number(cell.value);
  }
  const result = calculateExcelRow(inputs);
  for (const [key,value] of Object.entries(result)) {
    const cell = row[key];
    const expected = Number(cell?.value);
    const pass = cell && cell.value !== null && cell.type !== 'e' && Number.isFinite(expected)
      && Math.abs(value-expected) <= 1e-10 * Math.max(1,Math.abs(expected));
    console.log(`Workbook ${process.argv.slice(2).indexOf(file)+1}: ${key}8 ${pass?'PASS':'FAIL'}`);
    if (!pass) failed=true;
  }
}
if (process.argv.length < 3) throw new Error('Provide private audit.json paths');
process.exitCode = failed ? 1 : 0;
