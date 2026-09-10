// MAIN sheet of "Material_M&P MRP 4-1_Ver_(Toy).xlsm", rebuilt on the Supabase
// copy of sheet DATA. The Excel flow is preserved step for step:
//   ';}o'!P1 = ITEM & Package & Set of Color        -> the CODE stamped on every row
//   Arrange_Type_Work  -> "กรองข้อมูล": DATA rows whose column A = the chosen ITEM
//   Edit DATA          -> the editable staging grid below the picker
//   add_Item           -> "เพิ่มจำนวน": ask a quantity, append the block to BOMSHEET
//   Add_Data_Customer  -> "เพิ่มข้อมูล": stamp the header block onto BOMSHEET
// DATA is read-only; BOMSHEET is working state and lives in this browser only.
import {COLUMNS, FIELDS, listItems, listDepartments, listCustomers, listPackages,
        listColorSets, filterByItem, countRows, dataError} from './mrp-data.mjs';

const $ = s => document.querySelector(s);
const KEY = 'mnp-mrp-bomsheet-v1';
const HEADER_FIELDS = ['customer','pi','rev','country','d-order','d-wh','d-rb','d-gr','d-pt','d-bg','d-st','d-pk'];
const WIDE = new Set(['name']);

let staging = [], sheet = load(), departments = [], busy = false;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.lines)) return {header: saved.header || {}, lines: saved.lines};
  } catch { toast('อ่าน BOMSHEET เดิมในเครื่องไม่ได้ เริ่มใบใหม่ให้แทน'); }
  return {header: {}, lines: []};
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(sheet)); }
  catch { toast('บันทึกลง Browser ไม่สำเร็จ กรุณาตรวจพื้นที่จัดเก็บ'); }
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').className = 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').className = ''; }, 2600);
}
const trim = value => String(value ?? '').trim();
const options = (select, values, label = v => v) => {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label(value);
    select.append(option);
  }
};

// ';}o'!P1 = B1 & K1 & N1 — plain concatenation, exactly as the workbook does it.
function composed() {
  return trim($('#item').value) + trim($('#package').value) + trim($('#colorset').value);
}
function refreshComposed() {
  $('#composed').value = composed();
  $('#order-type').value = trim($('#country').value).toLowerCase() === 'thailand' ? 'ในประเทศ' : 'ต่างประเทศ';
}

function deptOptions(select, keep) {
  const previous = keep ?? select.value;
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = 'ALL'; all.textContent = 'ทุกแผนก';
  select.append(all);
  for (const dept of departments) {
    const option = document.createElement('option');
    option.value = dept.code;
    option.textContent = dept.name && dept.name !== dept.code ? `${dept.code} — ${dept.name}` : dept.code;
    select.append(option);
  }
  select.value = [...select.options].some(o => o.value === previous) ? previous : 'ALL';
}

function headerRow(table, extra = []) {
  const row = table.createTHead().insertRow();
  for (const title of extra) {
    const th = document.createElement('th'); th.textContent = title; row.append(th);
  }
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    th.append(document.createTextNode(column.header));
    const small = document.createElement('small'); small.textContent = column.excel;
    th.append(small);
    row.append(th);
  }
  return row;
}

// ---- Edit DATA (staging grid) -------------------------------------------------
function renderStaging() {
  const wrap = $('#edit-wrap'), dept = $('#edit-dept').value;
  const rows = staging.map((row, index) => ({row, index}))
    .filter(({row}) => dept === 'ALL' || trim(row.maker_dept) === dept);
  if (!staging.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่ได้กรองข้อมูล'}));
    return;
  }
  const table = document.createElement('table');
  headerRow(table, ['แถว DATA', '']);
  const body = table.createTBody();
  for (const {row, index} of rows) {
    const tr = body.insertRow();
    const num = tr.insertCell(); num.className = 'rownum'; num.textContent = row.row_no ?? '-';
    const act = tr.insertCell(); act.className = 'act';
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = 'ลบ'; del.dataset.remove = String(index);
    act.append(del);
    for (const column of COLUMNS) {
      const cell = tr.insertCell();
      cell.textContent = row[column.field] ?? '';
      cell.contentEditable = 'true';
      cell.dataset.index = String(index);
      cell.dataset.field = column.field;
      if (WIDE.has(column.field)) cell.className = 'wide';
    }
  }
  wrap.replaceChildren(table);
  if (!rows.length) wrap.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'แผนกนี้ไม่มีรายการ'}));
  $('#add-item').disabled = !staging.length || busy;
}

// ---- BOMSHEET -----------------------------------------------------------------
function renderHeader() {
  const box = $('#bom-header'), labels = {
    customer:'ชื่อลูกค้า', pi:'เลขที่เอกสาร PI', rev:'แก้ไขฉบับที่', country:'ประเทศ',
    'order-type':'ประเภทออร์เดอร์', 'd-order':'วันที่สั่งผลิต', 'd-wh':'วันส่งมอบ-WH',
    'd-rb':'กำหนดผลิตเสร็จ RB', 'd-gr':'กำหนดผลิตเสร็จ GR', 'd-pt':'กำหนดผลิตเสร็จ PT',
    'd-bg':'กำหนดผลิตเสร็จ BG', 'd-st':'กำหนดผลิตเสร็จ ST', 'd-pk':'กำหนดของเข้า PK'
  };
  box.replaceChildren();
  const entries = Object.entries(labels).filter(([key]) => trim(sheet.header[key]));
  if (!entries.length) {
    box.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่ได้กดปุ่ม "เพิ่มข้อมูล" เพื่อผูกหัวเอกสาร'}));
    return;
  }
  for (const [key, label] of entries) {
    const cell = document.createElement('div');
    const name = document.createElement('b'); name.textContent = label;
    cell.append(name, document.createTextNode(sheet.header[key]));
    box.append(cell);
  }
}
function renderSheet() {
  const wrap = $('#bom-wrap'), dept = $('#bom-dept').value;
  const rows = sheet.lines.map((row, index) => ({row, index}))
    .filter(({row}) => dept === 'ALL' || trim(row.maker_dept) === dept);
  if (!sheet.lines.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่มีรายการใน BOMSHEET'}));
    return;
  }
  const table = document.createElement('table');
  headerRow(table, ['ลำดับ', 'จำนวนสั่ง', '']);
  const body = table.createTBody();
  for (const {row, index} of rows) {
    const tr = body.insertRow();
    const seq = tr.insertCell(); seq.className = 'rownum'; seq.textContent = String(index + 1);
    const qty = tr.insertCell(); qty.className = 'rownum'; qty.textContent = row.order_qty;
    const act = tr.insertCell(); act.className = 'act';
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = 'ลบ'; del.dataset.sheetRemove = String(index);
    act.append(del);
    for (const column of COLUMNS) {
      const cell = tr.insertCell();
      cell.textContent = row[column.field] ?? '';
      if (WIDE.has(column.field)) cell.className = 'wide';
    }
  }
  wrap.replaceChildren(table);
  if (!rows.length) wrap.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'แผนกนี้ไม่มีรายการ'}));
}

function csv() {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const head = ['ลำดับ', 'จำนวนสั่ง', ...COLUMNS.map(c => c.header)].map(quote).join(',');
  const body = sheet.lines.map((row, index) =>
    [index + 1, row.order_qty, ...FIELDS.map(field => row[field])].map(quote).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}

// ---- wiring -------------------------------------------------------------------
async function boot() {
  try {
    const [items, depts, customers, packages, colors, total] = await Promise.all([
      listItems(), listDepartments(), listCustomers(), listPackages(), listColorSets(), countRows()
    ]);
    departments = depts.filter(d => d.code);
    options($('#item'), items.map(i => i.item));
    options($('#customer'), ['', ...customers.map(c => c.name)], v => v || '— ยังไม่เลือก —');
    options($('#package'), ['', ...packages.map(p => p.code)], v => v || '— ไม่มี —');
    options($('#colorset'), ['', ...colors.map(c => c.code)], v => v || '— ไม่มี —');
    deptOptions($('#edit-dept')); deptOptions($('#bom-dept'));
    renderDepartments();
    $('#source-note').textContent =
      `ฐานข้อมูลชีต DATA คอลัมน์ A–U • ${total.toLocaleString('th-TH')} บรรทัด • ${items.length.toLocaleString('th-TH')} ITEM • แผนกอ้างอิงคอลัมน์ L แผนกผู้ผลิต • DATA อ่านอย่างเดียว`;
    refreshComposed();
  } catch (error) {
    $('#source-note').textContent = dataError(error);
    $('#filter').disabled = true;
  }
  for (const key of HEADER_FIELDS) {
    const input = document.getElementById(key);
    if (input && sheet.header[key] !== undefined) input.value = sheet.header[key];
  }
  refreshComposed(); renderHeader(); renderSheet(); renderStaging();
}

function renderDepartments() {
  const table = document.createElement('table');
  table.className = 'dept-sum';
  const head = table.createTHead().insertRow();
  for (const title of ['รหัสแผนก (คอลัมน์ L)', 'ชื่อแผนก', 'บรรทัดในฐานข้อมูล', 'ใน BOMSHEET']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const dept of departments) {
    const tr = body.insertRow();
    tr.insertCell().textContent = dept.code;
    tr.insertCell().textContent = dept.name || dept.code;
    tr.insertCell().textContent = Number(dept.line_count || 0).toLocaleString('th-TH');
    tr.insertCell().textContent = String(sheet.lines.filter(l => trim(l.maker_dept) === dept.code).length);
  }
  $('#dept-wrap').replaceChildren(table);
}

$('#country').addEventListener('input', refreshComposed);
for (const id of ['#item', '#package', '#colorset']) $(id).addEventListener('change', refreshComposed);

$('#filter').onclick = async () => {
  if (busy) return;
  const item = $('#item').value;
  if (!item) { toast('ยังไม่มี ITEM ให้เลือก'); return; }
  busy = true; $('#filter').disabled = true; $('#pick-status').textContent = 'กำลังกรองข้อมูลจากชีต DATA…';
  try {
    staging = await filterByItem(item, composed());
    $('#pick-status').textContent = staging.length
      ? `กรองได้ ${staging.length} บรรทัด — แก้ไขได้ก่อนกดเพิ่มจำนวน`
      : 'ไม่พบบรรทัดของ ITEM นี้ในชีต DATA';
    renderStaging();
  } catch (error) {
    $('#pick-status').textContent = dataError(error);
  } finally { busy = false; $('#filter').disabled = false; renderStaging(); }
};

$('#edit-wrap').addEventListener('input', event => {
  const cell = event.target.closest('td[contenteditable]');
  if (!cell) return;
  const row = staging[Number(cell.dataset.index)];
  if (row) row[cell.dataset.field] = cell.textContent;
});
$('#edit-wrap').addEventListener('click', event => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  staging.splice(Number(button.dataset.remove), 1);
  renderStaging();
});
$('#edit-dept').addEventListener('change', renderStaging);
$('#bom-dept').addEventListener('change', renderSheet);
$('#edit-clear').onclick = () => { staging = []; $('#pick-status').textContent = 'ล้างตารางแล้ว'; renderStaging(); };

$('#add-item').onclick = () => {
  if (!staging.length) return;
  $('#qty-note').textContent = `${composed() || $('#item').value} • ${staging.length} บรรทัด`;
  $('#qty').value = '1';
  $('#qty-dialog').showModal();
};
$('#qty-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'ok') return;
  const qty = Number($('#qty').value);
  if (!Number.isFinite(qty) || qty <= 0) { event.preventDefault(); toast('จำนวนสั่งต้องมากกว่าศูนย์'); return; }
  for (const row of staging) {
    const line = {order_qty: qty, row_no: row.row_no};
    for (const field of FIELDS) line[field] = row[field] ?? '';
    sheet.lines.push(line);
  }
  persist(); renderSheet(); renderDepartments();
  toast(`เพิ่ม ${staging.length} บรรทัดเข้า BOMSHEET แล้ว`);
});

$('#apply-header').onclick = () => {
  refreshComposed();
  const header = {};
  for (const key of HEADER_FIELDS) header[key] = document.getElementById(key).value;
  header['order-type'] = $('#order-type').value;
  sheet.header = header; persist(); renderHeader();
  $('#header-status').textContent = 'ผูกหัวเอกสารกับ BOMSHEET แล้ว';
};

$('#bom-wrap').addEventListener('click', event => {
  const button = event.target.closest('button[data-sheet-remove]');
  if (!button) return;
  sheet.lines.splice(Number(button.dataset.sheetRemove), 1);
  persist(); renderSheet(); renderDepartments();
});
$('#bom-clear').onclick = () => {
  if (!sheet.lines.length) return;
  if (!confirm('ล้างรายการทั้งหมดใน BOMSHEET? หัวเอกสารจะยังอยู่')) return;
  sheet.lines = []; persist(); renderSheet(); renderDepartments(); toast('ล้าง BOMSHEET แล้ว');
};
$('#bom-print').onclick = () => window.print();
$('#bom-export').onclick = () => {
  if (!sheet.lines.length) { toast('ยังไม่มีรายการให้บันทึก'); return; }
  const url = URL.createObjectURL(new Blob([csv()], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `BOMSHEET-${trim(sheet.header.pi) || 'ไม่ระบุ PI'}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

boot();
