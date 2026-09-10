import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, checkHeader} from './mrp-csv.mjs';

const HEADERS = ['ITEM','น.น RB/g','CODE','รหัสแผนก','สินค้า/สูตรยาง','สีSE/ประเภทยาง','ความยาวSE/สีRB',
  'รู,ความหนา/ความยาวRB','วงนอกSE/รูในRB','วงนอกRB','NAME','แผนกผู้ผลิต','จำนวนที่ใช้ต่อชุด','ความยาวตัด',
  'หน่วย','จำนวนชิ้นที่ได้ต่อเส้น RB','หน่วย','จำนวนที่ได้ต่อ 1 GR','หน่วย','หน่วยนับ RB','น.น ต่อเส้น RB / ก.ก'];

test('keeps commas and quotes that appear inside DATA cells', () => {
  const rows = parseCsv('a,"รู,ความหนา",c\r\n1,"เขา ""4 นิ้ว"" ยาว",3\r\n');
  assert.deepEqual(rows, [['a','รู,ความหนา','c'], ['1','เขา "4 นิ้ว" ยาว','3']]);
});

test('keeps a newline inside a quoted NAME cell on one row', () => {
  assert.deepEqual(parseCsv('a,"line1\nline2",c'), [['a','line1\nline2','c']]);
});

test('keeps leading and trailing spaces, which the source workbook really has', () => {
  assert.deepEqual(parseCsv('Nasco-MCQL-28 , F01-346,SE '), [['Nasco-MCQL-28 ',' F01-346','SE ']]);
});

test('strips the BOM Excel writes so the first header still matches', () => {
  assert.deepEqual(parseCsv('﻿ITEM,CODE'), [['ITEM','CODE']]);
});

test('keeps empty trailing fields rather than dropping the column', () => {
  assert.deepEqual(parseCsv('a,,c\n1,2,'), [['a','','c'], ['1','2','']]);
});

test('accepts the real DATA header row', () => {
  assert.equal(checkHeader(HEADERS, HEADERS), null);
});

test('rejects a file whose column count is not 21', () => {
  assert.match(checkHeader(HEADERS.slice(0, 20), HEADERS), /21 คอลัมน์/);
});

test('rejects a header that is not sheet DATA, naming the column', () => {
  const wrong = [...HEADERS]; wrong[11] = 'รหัสแผนก';
  assert.match(checkHeader(wrong, HEADERS), /คอลัมน์ที่ 12/);
});

test('ignores only whitespace differences in the header', () => {
  const spaced = HEADERS.map((h, i) => i === 4 ? '  สินค้า/สูตรยาง  ' : h);
  assert.equal(checkHeader(spaced, HEADERS), null);
});
