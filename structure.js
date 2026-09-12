// โครงสร้างสินค้า — ผังหน้าจอตามระบบเดิม (Group View ค้นหาหมวดหมู่ →
// แท็บ General/Structure/Image) ต่อกับตารางจริงบน Supabase: mst_items สำหรับ
// ข้อมูลสินค้า และ prod_boms/prod_bom_lines สำหรับโครงสร้าง โดยลูกของแต่ละ
// โหนดคือ BOM ของ "ตัวชิ้นส่วนนั้นเอง" ไล่ซ้อนกันลงไป — ไม่มีตารางต้นไม้แยก
import {createAppClient, cloudError} from './supabase-client.mjs';
import {enforceSessionTtl, watchLoginMarks, isAdmin} from './auth-gate.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let client, user = null;
let items = [], uoms = [], depts = [], boms = [], bomLines = [];
let mode = 'edit', current = null;            // สินค้าที่เปิดอยู่
let found = [], colFilters = {};              // ผลค้นหา Group View + ตัวกรองรายคอลัมน์
let collapsed = new Set(), selectedPath = null, clipboard = null, dialogMode = null;

// ระบบเดิมแยกเมนูตามสิ่งที่ทำได้ในหน้าจอเดียวกัน — โหมดจึงคุมทั้ง 3 อย่าง:
// ฟิลด์ไหนแก้ได้ ปุ่มไหนกดได้ และ Group View ค้นเจอสินค้ากลุ่มไหน
const MODES = {
  new:      {title: 'โครงสร้างสินค้า-ใหม่', label: 'ใหม่', editable: 'all', canNew: true, canEdit: false},
  edit:     {title: 'โครงสร้างสินค้า-แก้ไข', label: 'แก้ไข', editable: 'all', canNew: false, canEdit: true},
  view:     {title: 'โครงสร้างสินค้า-ดู', label: 'ดู', editable: 'none', canNew: false, canEdit: false},
  inactive: {title: 'โครงสร้างสินค้า-ไม่เก็บ', label: 'ไม่เก็บ', editable: 'none', canNew: false, canEdit: false, scope: 'inactive'},
  recode:   {title: 'โครงสร้างสินค้า-เปลี่ยนรหัส', label: 'เปลี่ยนรหัส', editable: 'code', canNew: false, canEdit: true},
  reunit:   {title: 'โครงสร้างสินค้า-เปลี่ยนหน่วย', label: 'เปลี่ยนหน่วย', editable: 'uom', canNew: false, canEdit: true},
  used:     {title: 'โครงสร้างสินค้า-มีการใช้งาน', label: 'มีการใช้งาน', editable: 'none', canNew: false, canEdit: false, scope: 'used'}
};

// id ของ input → คอลัมน์ใน mst_items (ชื่อฟิลด์ตามผังหน้าจอเดิม)
const FORM = {
  'f-name-en': 'name_en', 'f-name': 'name', 'f-code': 'code', 'f-code2': 'code_secondary', 'f-barcode': 'barcode',
  'f-uom': 'uom_code', 'f-uom2': 'uom_secondary_code', 'f-uom2-qty': 'uom_secondary_qty',
  'f-type': 'item_type', 'f-class': 'item_class', 'f-subtype': 'item_subtype', 'f-group': 'item_group',
  'f-description': 'description', 'f-shape': 'shape',
  'f-len': 'dim_length', 'f-len-uom': 'dim_length_uom', 'f-wid': 'dim_width', 'f-wid-uom': 'dim_width_uom',
  'f-thk': 'dim_thickness', 'f-thk-uom': 'dim_thickness_uom', 'f-hgt': 'dim_height', 'f-hgt-uom': 'dim_height_uom',
  'f-vol': 'volume', 'f-vol-uom': 'volume_uom', 'f-process': 'process_time_min',
  'f-size': 'size_value', 'f-size-uom': 'size_uom', 'f-wmin': 'weight_min',
  'f-wpp': 'weight_per_piece', 'f-wpp-uom': 'weight_per_piece_uom', 'f-wmax': 'weight_max',
  'f-scrap': 'scrap_qty', 'f-from': 'valid_from', 'f-to': 'valid_to'
};
const CODE_FIELDS = ['f-code', 'f-code2'];
const UOM_FIELDS = ['f-uom', 'f-uom2', 'f-uom2-qty'];
const ITEM_COLUMNS = 'id,code,name,name_en,code_secondary,barcode,item_type,uom_code,uom_secondary_code,uom_secondary_qty,item_class,item_subtype,item_group,is_active,description,shape,dim_length,dim_width,dim_thickness,dim_height,dim_length_uom,dim_width_uom,dim_thickness_uom,dim_height_uom,volume,volume_uom,process_time_min,size_value,size_uom,weight_min,weight_per_piece,weight_max,weight_per_piece_uom,scrap_qty,valid_from,valid_to,used_count,revision';

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').className = 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').className = ''; }, 2600);
}

function options(select, rows, valueOf, labelOf, placeholder) {
  const keep = select.value;
  select.replaceChildren();
  if (placeholder !== undefined) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder;
    select.append(opt);
  }
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = valueOf(row); opt.textContent = labelOf(row);
    select.append(opt);
  }
  if (keep) select.value = keep;
}

const itemById = id => items.find(i => i.id === id) ?? null;
const itemLabel = item => `${item.code} — ${item.name}`;
const num = value => (value === null || value === undefined || value === '' ? '' : Number(value).toLocaleString('th-TH', {maximumFractionDigits: 4}));

// ---- auth ------------------------------------------------------------------
async function renderAuth() {
  $('#auth-status').textContent = user ? `เข้าสู่ระบบแล้ว: ${user.email}` : 'ยังไม่ได้เข้าสู่ระบบ';
  $('#gate').hidden = !!user;
  if (!user) { $('#restricted').hidden = true; $('#workspace').hidden = true; return false; }
  const admin = await isAdmin(client);
  $('#restricted').hidden = admin;
  $('#workspace').hidden = !admin;
  $('#session-chip').textContent = `ผู้ใช้ : ${user.email} , บริษัท : MNP`;
  return admin;
}

// ---- data ------------------------------------------------------------------
async function loadAll() {
  try {
    const [itemsRes, uomsRes, deptsRes, bomsRes, linesRes] = await Promise.all([
      client.from('mst_items').select(ITEM_COLUMNS).order('code'),
      client.from('mst_uom').select('code,name').order('code'),
      client.from('org_departments').select('code,name').eq('is_active', true).order('code'),
      client.from('prod_boms').select('id,item_id,version,is_active,created_at').order('created_at', {ascending: false}),
      client.from('prod_bom_lines').select('id,bom_id,component_item_id,qty_per_unit,scrap_pct,dept_code')
    ]);
    for (const res of [itemsRes, uomsRes, deptsRes, bomsRes, linesRes]) if (res.error) throw res.error;
    items = itemsRes.data; uoms = uomsRes.data; depts = deptsRes.data;
    boms = bomsRes.data; bomLines = linesRes.data;
    fillPickers();
    renderCategories();
    runSearch();
    renderList();
    if (current) openItem(current.id, {keepTab: true});
  } catch (error) { toast(cloudError(error)); }
}

function fillPickers() {
  const uomLabel = u => `${u.code} — ${u.name}`;
  options($('#f-uom'), uoms, u => u.code, uomLabel);
  options($('#f-uom2'), uoms, u => u.code, uomLabel, '— ไม่มี —');
  options($('#st-uom'), uoms, u => u.code, u => u.code);
  options($('#line-dept'), depts, d => d.code, d => (d.name && d.name !== d.code ? `${d.code} — ${d.name}` : d.code), '— ไม่ระบุแผนก —');
  for (const id of ['f-len-uom', 'f-wid-uom', 'f-thk-uom', 'f-hgt-uom', 'f-size-uom']) {
    options($(`#${id}`), [{c: 'mm'}, {c: 'cm'}, {c: 'm'}, {c: 'inch'}], r => r.c, r => r.c);
  }
}

// ---- โหมดเมนูซ้าย -----------------------------------------------------------
function setMode(next) {
  mode = next;
  const config = MODES[mode];
  $('#mode-title').textContent = config.title;
  $('#gv-mode').textContent = config.label;
  $$('#nav button[data-mode]').forEach(button => {
    const on = button.dataset.mode === mode;
    button.classList.toggle('active', on);
    if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (mode === 'new') { current = null; setDefaults(); }
  applyEditable();
  runSearch();
  renderTree();
}

function applyEditable() {
  const {editable, canNew, canEdit} = MODES[mode];
  for (const id of Object.keys(FORM)) {
    const el = $(`#${id}`);
    if (!el) continue;
    const allowed = editable === 'all' ? true
      : editable === 'code' ? CODE_FIELDS.includes(id)
      : editable === 'uom' ? UOM_FIELDS.includes(id)
      : false;
    el.disabled = !allowed;
  }
  $('#f-process').disabled = true;                 // มาจาก Routing ไม่ใช่กรอกมือ (เหมือนระบบเดิม)
  $('#btn-save-new').disabled = !canNew;
  $('#btn-save-edit').disabled = !(canEdit && current);
  $('#st-add').disabled = !(selectedPath && current && editable === 'all');
  $('#st-copy').disabled = !(selectedPath && current && editable === 'all');
}

// ---- Group View -------------------------------------------------------------
function categoryKey(item) { return `${item.item_class ?? ''}|${item.item_subtype ?? ''}|${item.item_group ?? ''}`; }
function categoryLabel(key) { const [c, s, g] = key.split('|'); return `${c || '—'} --${s || ''} --${g || ''}`; }

function renderCategories() {
  const keys = [...new Set(items.map(categoryKey))].sort((a, b) => a.localeCompare(b, 'th'));
  options($('#gv-category'), keys.map(k => ({k})), r => r.k, r => categoryLabel(r.k), '-- ทุกหมวดหมู่ --');
}

function scopedItems() {
  const scope = MODES[mode].scope;
  if (scope === 'inactive') return items.filter(i => i.is_active === false);
  if (scope === 'used') return items.filter(i => bomLines.some(l => l.component_item_id === i.id));
  return items.filter(i => i.is_active !== false);
}

function runSearch() {
  const key = $('#gv-category').value;
  const field = $('#gv-field').value;
  const keyword = $('#gv-keyword').value.trim().toLowerCase();
  found = scopedItems().filter(item =>
    (!key || categoryKey(item) === key) &&
    (!keyword || String(item[field] ?? '').toLowerCase().includes(keyword))
  );
  $('#gv-found').textContent = `${found.length} product(s) found.`;
  renderResults();
}

const RESULT_COLUMNS = [
  {key: 'code', title: 'รหัส'},
  {key: 'code_secondary', title: 'ต่อท้ายรหัส'},
  {key: 'name_en', title: 'ชื่ออังกฤษ'},
  {key: 'name', title: 'ชื่อไทย'},
  {key: 'description', title: 'รายละเอียด'}
];

function renderResults() {
  const wrap = $('#gv-results');
  const rows = found.filter(item => RESULT_COLUMNS.every(col => {
    const needle = (colFilters[col.key] ?? '').toLowerCase();
    return !needle || String(item[col.key] ?? '').toLowerCase().includes(needle);
  }));
  const table = document.createElement('table');
  const head = table.createTHead();
  const titleRow = head.insertRow();
  for (const col of RESULT_COLUMNS) { const th = document.createElement('th'); th.textContent = col.title; titleRow.append(th); }
  const filterRow = head.insertRow();
  filterRow.className = 'filter-row';
  for (const col of RESULT_COLUMNS) {
    const th = document.createElement('th');
    const input = document.createElement('input');
    input.value = colFilters[col.key] ?? ''; input.dataset.filter = col.key;
    input.setAttribute('aria-label', `กรอง ${col.title}`);
    th.append(input); filterRow.append(th);
  }
  const body = table.createTBody();
  for (const item of rows) {
    const tr = body.insertRow();
    tr.dataset.itemId = item.id;
    if (current?.id === item.id) tr.classList.add('on');
    for (const col of RESULT_COLUMNS) tr.insertCell().textContent = item[col.key] ?? '';
  }
  if (!rows.length) {
    const tr = body.insertRow();
    const td = tr.insertCell();
    td.colSpan = RESULT_COLUMNS.length; td.className = 'empty'; td.textContent = 'ไม่พบสินค้าตามเงื่อนไข';
  }
  wrap.replaceChildren(table);
}

function renderList() {
  const wrap = $('#list-results');
  const rows = scopedItems();
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['รหัส', 'ชื่อไทย', 'ชื่ออังกฤษ', 'คลาส', 'ไทป์', 'กรุ๊ป', 'ประเภท', 'หน่วย']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const item of rows) {
    const tr = body.insertRow();
    tr.dataset.itemId = item.id;
    if (current?.id === item.id) tr.classList.add('on');
    for (const value of [item.code, item.name, item.name_en, item.item_class, item.item_subtype, item.item_group, item.item_type, item.uom_code]) {
      tr.insertCell().textContent = value ?? '';
    }
  }
  wrap.replaceChildren(rows.length ? table : Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ไม่มีสินค้าในกลุ่มนี้'}));
}

// Plan View = where-used: สินค้าตัวนี้ไปเป็นชิ้นส่วนของใครบ้าง
function renderPlan() {
  const wrap = $('#plan-results');
  if (!current) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่ได้เลือกสินค้า'}));
    return;
  }
  const rows = bomLines.filter(line => line.component_item_id === current.id).map(line => {
    const bom = boms.find(b => b.id === line.bom_id);
    return {parent: bom ? itemById(bom.item_id) : null, version: bom?.version ?? '', qty: line.qty_per_unit};
  });
  if (!rows.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'สินค้านี้ยังไม่ถูกใช้ในโครงสร้างของสินค้าใด'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['ใช้ในสินค้า', 'ชื่อ', 'เวอร์ชัน BOM', 'จำนวนต่อหน่วย']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = row.parent?.code ?? '-';
    tr.insertCell().textContent = row.parent?.name ?? '-';
    tr.insertCell().textContent = row.version;
    tr.insertCell().textContent = num(row.qty);
  }
  wrap.replaceChildren(table);
}

// ---- General tab ------------------------------------------------------------
// ช่องตัวเลขในหน้าจอเดิมโชว์ 0.000 ไม่ใช่ช่องว่าง (หน่วยย่อยเริ่มที่ 1.0000)
function numberDefault(column) { return column === 'uom_secondary_qty' ? '1.0000' : '0.000'; }

function setDefaults() {
  for (const [id, column] of Object.entries(FORM)) {
    const el = $(`#${id}`);
    if (!el) continue;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else if (el.type === 'number') el.value = numberDefault(column);
    else if (el.type === 'date') el.value = column === 'valid_from' ? new Date().toISOString().slice(0, 10) : '';
    else el.value = '';
  }
  $('#f-uom-qty').value = '1.0000';
  $('#f-process').value = '0.0000';
  $('#f-used').value = '0.0';
  $('#f-revision').value = '0';
  $('#form-status').textContent = '';
}

function fillForm(item) {
  for (const [id, column] of Object.entries(FORM)) {
    const el = $(`#${id}`);
    if (!el) continue;
    const value = item[column];
    if (el.tagName === 'SELECT') {
      el.value = value ?? '';
      // คอลัมน์หน่วยที่ยังเป็น null ให้ตกมาที่ตัวเลือกแรก (mm/KG/ไม่มี) แทนที่จะว่างเปล่า
      if (!el.value) el.selectedIndex = 0;
    } else if (el.type === 'number') {
      el.value = value ?? numberDefault(column);
    } else {
      el.value = value ?? '';
    }
  }
  $('#f-uom-qty').value = '1.0000';
  $('#f-used').value = String(bomLines.filter(l => l.component_item_id === item.id).length);
  $('#f-revision').value = String(item.revision ?? 0);
}

// กติกา 3 ข้อในกล่อง "หมายเหตุ+" ของหน้าจอเดิม — เช็คฝั่งเบราว์เซอร์ด้วยเพื่อให้
// ได้ข้อความไทย แทนที่จะเด้ง constraint ดิบจาก Postgres
function badText(value, label) {
  if (!value) return null;
  if (!/^[A-Za-z0-9ก-๙]/.test(value)) return `${label} ห้ามขึ้นต้นด้วยสัญลักษณ์`;
  if (value.includes('#')) return `${label} ห้ามมีสัญลักษณ์ #`;
  if (/[\\']/.test(value)) return `${label} ห้ามมีสัญลักษณ์ \\ หรือ '`;
  return null;
}

function collectForm() {
  const payload = {};
  for (const [id, column] of Object.entries(FORM)) {
    const el = $(`#${id}`);
    if (!el) continue;
    const raw = el.value.trim();
    if (el.type === 'number') payload[column] = raw === '' ? null : Number(raw);
    else payload[column] = raw === '' ? null : raw;
  }
  return payload;
}

async function saveItem(isNew) {
  const payload = collectForm();
  const bad = badText(payload.name_en, 'ชื่ออังกฤษ') || badText(payload.name, 'ชื่อไทย') || badText(payload.code, 'รหัส');
  if (bad) { $('#form-status').textContent = bad; toast(bad); return; }
  if (!payload.code || !payload.name || !payload.name_en) { toast('ต้องกรอก ชื่ออังกฤษ / ชื่อไทย / รหัส'); return; }
  if (!payload.uom_code) { toast('ต้องเลือกหน่วย'); return; }
  $('#form-status').textContent = 'กำลังบันทึก…';
  try {
    if (isNew) {
      const {data, error} = await client.from('mst_items').insert(payload).select('id').single();
      if (error) throw error;
      await loadAll();
      openItem(data.id);
      $('#form-status').textContent = 'บันทึกสินค้าใหม่แล้ว';
      toast('บันทึกสินค้าใหม่แล้ว');
    } else {
      payload.revision = Number(current.revision ?? 0) + 1;
      const {error} = await client.from('mst_items').update(payload).eq('id', current.id);
      if (error) throw error;
      await loadAll();
      openItem(current.id);
      $('#form-status').textContent = `บันทึกการแก้ไขแล้ว (Revision ${payload.revision})`;
      toast('บันทึกการแก้ไขแล้ว');
    }
  } catch (error) { $('#form-status').textContent = cloudError(error); toast(cloudError(error)); }
}

function openItem(itemId, {keepTab = false} = {}) {
  current = itemById(itemId);
  if (!current) return;
  fillForm(current);
  collapsed = new Set(); selectedPath = null;
  renderResults(); renderList(); renderPlan(); renderTree();
  applyEditable();
  if (!keepTab) $('#form-status').textContent = `เปิดสินค้า ${current.code}`;
}

// ---- Structure tab ----------------------------------------------------------
function activeBomForItem(itemId) {
  const candidates = boms.filter(b => b.item_id === itemId);
  return candidates.find(b => b.is_active) || candidates[0] || null;
}
const linesForBom = bomId => bomLines.filter(l => l.bom_id === bomId);

// จริงไหมว่า toItemId อยู่ใต้ fromItemId (หรือเป็นตัวเดียวกัน) — ใช้กันโครงสร้างวนกลับ
function reachable(fromItemId, toItemId) {
  const seen = new Set(); const queue = [fromItemId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toItemId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const bom = activeBomForItem(id);
    if (bom) for (const line of linesForBom(bom.id)) queue.push(line.component_item_id);
  }
  return false;
}

function walkTree(node, depth, path, ancestors, out) {
  const item = itemById(node.itemId);
  const cyclic = ancestors.has(node.itemId);
  const bom = cyclic ? null : activeBomForItem(node.itemId);
  const lines = bom ? linesForBom(bom.id) : [];
  out.push({...node, item, depth, path, cyclic, hasChildren: lines.length > 0});
  if (!lines.length || collapsed.has(path)) return out;
  const next = new Set(ancestors); next.add(node.itemId);
  for (const line of lines) {
    walkTree({itemId: line.component_item_id, lineId: line.id, qty: Number(line.qty_per_unit), scrap: Number(line.scrap_pct), dept: line.dept_code},
      depth + 1, `${path}>${line.id}`, next, out);
  }
  return out;
}

const TYPE_CLASS = {SERVICE: 't-process', WIP: 't-wip', RM: 't-part'};
const TREE_COLUMNS = ['รหัสสั้น', 'ชื่ออังกฤษ (Tree)', 'รหัส', 'ต่อท้ายรหัส', 'รายละเอียด', 'น้ำหนัก/ชิ้น', 'จำนวน *', 'หน่วย', 'จำนวนย่อย (Weight * Qty)', 'หน่วยย่อย'];

function renderTree() {
  const wrap = $('#st-tree');
  if (!current) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'เลือกสินค้าจาก Group View ก่อน'}));
    return;
  }
  const rows = walkTree({itemId: current.id, lineId: null, qty: 1, scrap: 0, dept: null}, 0, 'r', new Set(), []);
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  TREE_COLUMNS.forEach((title, index) => {
    const th = document.createElement('th');
    th.textContent = title;
    if (index >= 5 && index !== 7 && index !== 9) th.className = 'num';
    head.append(th);
  });
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    tr.dataset.path = row.path;
    tr.dataset.itemId = row.itemId;
    if (row.lineId) tr.dataset.lineId = row.lineId;
    if (row.path === selectedPath) tr.classList.add('on');
    if (clipboard && clipboard.lineId === row.lineId) tr.classList.add('cut');

    tr.insertCell().textContent = '';                                  // รหัสสั้น — ระบบเรายังไม่มีคอลัมน์นี้
    const treeCell = tr.insertCell();
    const indent = document.createElement('span');
    indent.className = 'tw'; indent.style.width = `${row.depth * 18}px`;
    const toggle = document.createElement('span');
    toggle.className = row.hasChildren ? 'tg' : 'tg leaf';
    toggle.textContent = row.hasChildren ? (collapsed.has(row.path) ? '+' : '−') : '';
    if (row.hasChildren) toggle.dataset.toggle = row.path;
    const dot = document.createElement('span');
    dot.className = 'tdot';
    const name = document.createElement('span');
    name.textContent = row.item ? (row.item.name_en || row.item.name) : row.itemId;
    if (row.cyclic) name.textContent += ' (โครงสร้างวนกลับ — ข้าม)';
    treeCell.className = TYPE_CLASS[row.item?.item_type] ?? 't-fg';
    treeCell.append(indent, toggle, dot, name);

    tr.insertCell().textContent = row.item?.code ?? '';
    tr.insertCell().textContent = row.item?.code_secondary ?? '';
    tr.insertCell().textContent = row.item?.description ?? '';
    const weight = row.item?.weight_per_piece;
    const cells = [
      {value: num(weight), num: true},
      {value: num(row.qty), num: true},
      {value: row.item?.uom_code ?? '', num: false},
      {value: weight === null || weight === undefined ? '' : num(Number(weight) * row.qty), num: true},
      {value: row.item?.uom_secondary_code ?? '', num: false}
    ];
    for (const cell of cells) {
      const td = tr.insertCell();
      td.textContent = cell.value;
      if (cell.num) td.className = 'num';
    }
  }
  wrap.replaceChildren(table);
}

// ---- เพิ่ม/แก้ไขบรรทัดโครงสร้าง ------------------------------------------------
async function ensureBom(itemId) {
  const existing = activeBomForItem(itemId);
  if (existing) return existing.id;
  const {data, error} = await client.from('prod_boms').insert({item_id: itemId, version: 'BOM-01'})
    .select('id,item_id,version,is_active,created_at').single();
  if (error) throw error;
  boms.push(data);
  return data.id;
}

async function addLine(parentItemId, componentItemId, qty, scrap, dept) {
  const bomId = await ensureBom(parentItemId);
  const {data, error} = await client.from('prod_bom_lines')
    .insert({bom_id: bomId, component_item_id: componentItemId, qty_per_unit: qty, scrap_pct: scrap, dept_code: dept})
    .select('id,bom_id,component_item_id,qty_per_unit,scrap_pct,dept_code').single();
  if (error) throw error;
  bomLines.push(data);
  return data;
}

function candidatesFor(targetItemId) {
  return items.filter(i => i.id !== targetItemId && !reachable(i.id, targetItemId));
}

function openLineDialog(next) {
  dialogMode = next;
  const componentSelect = $('#line-component');
  if (next.type === 'add') {
    const target = itemById(next.targetItemId);
    $('#line-title').textContent = 'เพิ่มโครงสร้างย่อย';
    $('#line-note').textContent = target ? `เพิ่มชิ้นส่วนภายใต้ ${itemLabel(target)}` : '';
    componentSelect.disabled = false;
    options(componentSelect, candidatesFor(next.targetItemId), i => i.id, itemLabel, '— เลือกสินค้า/ชิ้นส่วน —');
    componentSelect.value = '';
    $('#line-qty').value = '1'; $('#line-scrap').value = '0'; $('#line-dept').value = '';
  } else {
    const line = bomLines.find(l => l.id === next.lineId);
    const component = itemById(line?.component_item_id);
    $('#line-title').textContent = 'แก้ไขจำนวน/สูญเสีย';
    $('#line-note').textContent = component ? itemLabel(component) : '';
    componentSelect.disabled = true;
    options(componentSelect, component ? [component] : [], i => i.id, itemLabel);
    $('#line-qty').value = line?.qty_per_unit ?? '';
    $('#line-scrap').value = line ? Number(line.scrap_pct) * 100 : '0';
    $('#line-dept').value = line?.dept_code || '';
  }
  $('#line-dialog').showModal();
}

$('#line-form').addEventListener('submit', async event => {
  event.preventDefault();
  const dialog = $('#line-dialog');
  if (event.submitter?.value !== 'ok') { dialog.close(); dialogMode = null; return; }
  const qty = Number($('#line-qty').value);
  const scrap = (Number($('#line-scrap').value) || 0) / 100;
  const dept = $('#line-dept').value || null;
  if (!dialogMode || !Number.isFinite(qty) || qty <= 0) { toast('จำนวนต่อหน่วยต้องมากกว่าศูนย์'); return; }
  try {
    if (dialogMode.type === 'add') {
      const componentId = $('#line-component').value;
      if (!componentId) { toast('เลือกสินค้า/ชิ้นส่วนก่อน'); return; }
      await addLine(dialogMode.targetItemId, componentId, qty, scrap, dept);
      toast('เพิ่มโครงสร้างย่อยแล้ว');
    } else {
      const {error} = await client.from('prod_bom_lines')
        .update({qty_per_unit: qty, scrap_pct: scrap, dept_code: dept}).eq('id', dialogMode.lineId);
      if (error) throw error;
      const line = bomLines.find(l => l.id === dialogMode.lineId);
      if (line) { line.qty_per_unit = qty; line.scrap_pct = scrap; line.dept_code = dept; }
      toast('บันทึกการแก้ไขแล้ว');
    }
    dialog.close(); dialogMode = null;
    renderTree(); renderPlan();
  } catch (error) { toast(cloudError(error)); }
});

async function runAction(action, node) {
  if (action === 'add') { openLineDialog({type: 'add', targetItemId: node.itemId}); return; }
  if (action === 'edit') { if (node.lineId) openLineDialog({type: 'edit', lineId: node.lineId}); return; }

  if (action === 'cut') {
    const line = bomLines.find(l => l.id === node.lineId);
    if (!line) return;
    clipboard = {lineId: line.id, componentItemId: line.component_item_id, qty: line.qty_per_unit, scrap: line.scrap_pct, dept: line.dept_code};
    toast('ตัดชิ้นส่วนแล้ว — คลิกขวาที่จุดปลายทางแล้วเลือก "วาง"');
    renderTree();
    return;
  }

  if (action === 'paste') {
    if (!clipboard) return;
    try {
      await addLine(node.itemId, clipboard.componentItemId, clipboard.qty, clipboard.scrap, clipboard.dept);
      const {error} = await client.from('prod_bom_lines').delete().eq('id', clipboard.lineId);
      if (error) throw error;
      bomLines = bomLines.filter(l => l.id !== clipboard.lineId);
      clipboard = null;
      toast('ย้ายโครงสร้างแล้ว');
      renderTree(); renderPlan();
    } catch (error) { toast(cloudError(error)); }
    return;
  }

  if (action === 'delete') {
    const line = bomLines.find(l => l.id === node.lineId);
    const component = itemById(line?.component_item_id);
    if (!confirm(`ลบ "${component ? itemLabel(component) : ''}" ออกจากโครงสร้างนี้? (ตัวสินค้าและโครงสร้างย่อยของมันยังอยู่)`)) return;
    try {
      const {error} = await client.from('prod_bom_lines').delete().eq('id', node.lineId);
      if (error) throw error;
      bomLines = bomLines.filter(l => l.id !== node.lineId);
      if (clipboard?.lineId === node.lineId) clipboard = null;
      toast('ลบแล้ว');
      renderTree(); renderPlan();
    } catch (error) { toast(cloudError(error)); }
  }
}

// เมนูคลิกขวาแบบ fixed — ปิดเมื่อคลิกที่อื่นเท่านั้น (เคยผูก scroll ไว้ด้วยแล้วพบว่า
// การแทรกเมนูเองทำให้เกิด scroll จนเมนูปิดทันทีที่เปิด)
function closeMenu() { $('#ctx-menu').hidden = true; }
document.addEventListener('click', closeMenu);

$('#st-tree').addEventListener('contextmenu', event => {
  const tr = event.target.closest('tr[data-path]');
  if (!tr || MODES[mode].editable !== 'all') return;
  event.preventDefault();
  const node = {itemId: tr.dataset.itemId, lineId: tr.dataset.lineId || null};
  const isRoot = !node.lineId;
  const canPaste = !!clipboard && clipboard.componentItemId !== node.itemId
    && clipboard.lineId !== node.lineId && !reachable(clipboard.componentItemId, node.itemId);
  const menu = $('#ctx-menu');
  menu.replaceChildren();
  const entries = [
    {label: '➕ เพิ่มโครงสร้างย่อย', action: 'add', off: false},
    {label: '✏️ แก้ไขจำนวน/สูญเสีย', action: 'edit', off: isRoot},
    {label: '✂️ ตัด', action: 'cut', off: isRoot},
    {label: '📋 วาง', action: 'paste', off: !canPaste},
    {label: '🗑 ลบ', action: 'delete', off: isRoot, danger: true}
  ];
  for (const entry of entries) {
    const li = document.createElement('li');
    li.textContent = entry.label;
    if (entry.off) li.setAttribute('aria-disabled', 'true');
    else {
      if (entry.danger) li.classList.add('danger');
      li.addEventListener('click', () => { menu.hidden = true; runAction(entry.action, node); });
    }
    menu.append(li);
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
});

$('#st-tree').addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const path = toggle.dataset.toggle;
    if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
    renderTree();
    return;
  }
  const tr = event.target.closest('tr[data-path]');
  if (!tr) return;
  selectedPath = tr.dataset.path;
  const item = itemById(tr.dataset.itemId);
  $('#st-status').textContent = item ? `จะเพิ่มชิ้นส่วนใหม่ภายใต้: ${itemLabel(item)}` : '';
  applyEditable();
  renderTree();
});

function selectedNodeItemId() {
  if (!selectedPath) return null;
  const tr = $(`#st-tree tr[data-path="${CSS.escape(selectedPath)}"]`);
  return tr?.dataset.itemId ?? null;
}

// ฟอร์มล่างของแท็บ Structure: สร้าง "สินค้าใหม่" แล้วผูกเป็นลูกของโหนดที่เลือกทันที
$('#st-add').addEventListener('click', async () => {
  const parentItemId = selectedNodeItemId();
  if (!parentItemId) { toast('คลิกเลือกแถวในโครงสร้างก่อน'); return; }
  const nameEn = $('#st-name-en').value.trim(), name = $('#st-name').value.trim(), code = $('#st-code').value.trim();
  const bad = badText(nameEn, 'ชื่ออังกฤษ') || badText(name, 'ชื่อไทย') || badText(code, 'รหัส');
  if (bad) { toast(bad); return; }
  if (!nameEn || !name || !code) { toast('ต้องกรอก ชื่ออังกฤษ / ชื่อไทย / รหัส'); return; }
  $('#st-add').disabled = true;
  try {
    const {data: created, error} = await client.from('mst_items').insert({
      code, name, name_en: nameEn, code_secondary: $('#st-code2').value.trim() || null,
      item_type: $('#st-type').value, uom_code: $('#st-uom').value,
      item_class: current.item_class, item_subtype: current.item_subtype, item_group: current.item_group
    }).select(ITEM_COLUMNS).single();
    if (error) throw error;
    items.push(created);
    await addLine(parentItemId, created.id, 1, 0, null);
    for (const id of ['st-name-en', 'st-name', 'st-code', 'st-code2']) $(`#${id}`).value = '';
    toast(`สร้าง ${created.code} และเพิ่มเข้าโครงสร้างแล้ว`);
    renderCategories(); runSearch(); renderList(); renderTree();
  } catch (error) { toast(cloudError(error)); }
  finally { applyEditable(); }
});

// "คัดลอก.." ของระบบเดิม = หยิบสินค้าที่มีอยู่แล้วมาวางเป็นลูก แทนการสร้างใหม่
$('#st-copy').addEventListener('click', () => {
  const parentItemId = selectedNodeItemId();
  if (!parentItemId) { toast('คลิกเลือกแถวในโครงสร้างก่อน'); return; }
  openLineDialog({type: 'add', targetItemId: parentItemId});
});

// ---- แท็บ / แถบ View --------------------------------------------------------
$$('.tabstrip button[role="tab"]').forEach(tab => tab.addEventListener('click', () => {
  $$('.tabstrip button[role="tab"]').forEach(other => {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    $(`#${other.getAttribute('aria-controls')}`).hidden = !on;
  });
}));

$$('[data-view-toggle]').forEach(bar => bar.addEventListener('click', () => {
  const open = bar.getAttribute('aria-expanded') === 'true';
  bar.setAttribute('aria-expanded', String(!open));
  $(`#${bar.getAttribute('aria-controls')}`).hidden = open;
}));

$$('#nav button[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));

$('#gv-pick').addEventListener('click', () => { $('#gv-keyword').value = ''; colFilters = {}; runSearch(); });
$('#gv-search').addEventListener('click', runSearch);
$('#gv-category').addEventListener('change', runSearch);
$('#gv-keyword').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } });
$('#gv-results').addEventListener('input', event => {
  const input = event.target.closest('input[data-filter]');
  if (!input) return;
  colFilters[input.dataset.filter] = input.value;
  const key = input.dataset.filter;
  renderResults();
  const again = $(`#gv-results input[data-filter="${key}"]`);
  if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
});
for (const id of ['gv-results', 'list-results']) {
  $(`#${id}`).addEventListener('click', event => {
    const tr = event.target.closest('tr[data-item-id]');
    if (tr) openItem(tr.dataset.itemId);
  });
}

$('#btn-save-new').addEventListener('click', () => saveItem(true));
$('#btn-save-edit').addEventListener('click', () => saveItem(false));
$('#btn-defaults').addEventListener('click', () => { setDefaults(); toast('ตั้งค่าเริ่มต้นให้ฟอร์มแล้ว'); });

// ---- boot -------------------------------------------------------------------
async function boot() {
  client = createAppClient();
  $('#logout')?.addEventListener('click', () => client.auth.signOut());
  $('#logout-restricted')?.addEventListener('click', () => client.auth.signOut());
  $('#menu')?.addEventListener('click', () => document.body.classList.toggle('open'));
  watchLoginMarks(client);
  client.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    if (await renderAuth()) loadAll();
  });
  await enforceSessionTtl(client);
  const {data} = await client.auth.getUser();
  user = data?.user ?? null;
  setMode('edit');
  if (await renderAuth()) await loadAll();
}
boot();
