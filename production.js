// Item master + BOM against the real erp-core-schema.sql tables (mst_items,
// prod_boms, prod_bom_lines, org_departments, mst_uom) on the ERP_MNP
// Supabase project. Every table here requires an authenticated session with
// RLS-granted role — there is no anon-readable path, unlike mrp-data.mjs.
import {createAppClient, cloudError} from './supabase-client.mjs';
import {enforceSessionTtl, watchLoginMarks, isAdmin} from './auth-gate.mjs';

const $ = s => document.querySelector(s);
let client, user = null;
let items = [], uoms = [], depts = [];
let currentBomId = null, bomLines = [];
let currentRoutingId = null, routingSteps = [];
let structureBoms = [], structureBomLines = [];
let structureSelectedItemId = null, structureClipboard = null, structureDialogMode = null;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').className = 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').className = ''; }, 2600);
}

function options(select, rows, valueOf, labelOf, placeholder) {
  select.replaceChildren();
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder;
    select.append(opt);
  }
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = valueOf(row); opt.textContent = labelOf(row);
    select.append(opt);
  }
}

function deptLabel(dept) { return dept.name && dept.name !== dept.code ? `${dept.code} — ${dept.name}` : dept.code; }
function itemLabel(item) { return `${item.code} — ${item.name}`; }

// inv_apply_stock_ledger raises a plain Postgres exception (not a PGRST/network
// code) when a ledger row would drive a balance negative — cloudError()'s
// generic fallback would wrongly tell the user to check their network.
function stockError(error) {
  if (/insufficient stock/i.test(error?.message ?? '')) return `วัตถุดิบในคลังไม่พอ: ${error.message}`;
  return cloudError(error);
}

// ---- auth ---------------------------------------------------------------
async function renderAuth() {
  $('#auth-status').textContent = user ? `เข้าสู่ระบบแล้ว: ${user.email}` : 'ยังไม่ได้เข้าสู่ระบบ';
  $('#gate').hidden = !!user;
  if (!user) { $('#restricted').hidden = true; $('#workspace').hidden = true; return; }
  const admin = await isAdmin(client);
  $('#restricted').hidden = admin;
  $('#workspace').hidden = !admin;
  return admin;
}

// ---- item master ----------------------------------------------------------
function renderItems() {
  const wrap = $('#items-wrap');
  $('#items-count').textContent = items.length ? `${items.length} รายการ` : '';
  if (!items.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่มีสินค้า'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['รหัส', 'ชื่อ', 'คลาส', 'กรุ๊ป', 'ประเภท', 'หน่วย', 'ต้นทุน', 'ราคาขาย']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const item of items) {
    const tr = body.insertRow();
    tr.insertCell().textContent = item.code;
    tr.insertCell().textContent = item.name;
    tr.insertCell().textContent = item.item_class || '';
    tr.insertCell().textContent = item.item_group || '';
    tr.insertCell().textContent = item.item_type;
    tr.insertCell().textContent = item.uom_code;
    tr.insertCell().textContent = Number(item.standard_cost).toLocaleString('th-TH');
    tr.insertCell().textContent = Number(item.sales_price).toLocaleString('th-TH');
  }
  wrap.replaceChildren(table);
}

function populateItemPickers() {
  options($('#item-uom'), uoms, u => u.code, u => `${u.code} — ${u.name}`);
  options($('#item-uom-secondary'), uoms, u => u.code, u => `${u.code} — ${u.name}`, '— ไม่มี —');
  const fgItems = items.filter(i => i.item_type === 'FG');
  options($('#bom-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
  options($('#line-component'), items, i => i.id, itemLabel, '— เลือกวัตถุดิบ/ชิ้นส่วน —');
  options($('#line-dept'), depts, d => d.code, deptLabel, '— ไม่ระบุแผนก —');
  options($('#routing-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
  options($('#step-dept'), depts, d => d.code, deptLabel, '— เลือกแผนก —');
  options($('#mo-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
  resetLineRows();
  toggleItemLineFieldsets();
  refreshStructureFilterOptions();
  runStructureSearch();
  if (structureSelectedItemId) renderStructureTree();
}

async function loadMaster() {
  try {
    const [itemsRes, uomsRes, deptsRes] = await Promise.all([
      client.from('mst_items').select('id,code,name,name_en,code_secondary,barcode,item_type,uom_code,uom_secondary_code,uom_secondary_qty,item_class,item_subtype,item_group,standard_cost,sales_price,description,shape,dim_length,dim_width,dim_thickness,dim_height,dim_length_uom,volume,volume_uom,process_time_min,size_value,size_uom,weight_min,weight_per_piece,weight_max,weight_per_piece_uom,scrap_qty,valid_from,valid_to,used_count,revision').order('code'),
      client.from('mst_uom').select('code,name').order('code'),
      client.from('org_departments').select('code,name').eq('is_active', true).order('code')
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (uomsRes.error) throw uomsRes.error;
    if (deptsRes.error) throw deptsRes.error;
    items = itemsRes.data; uoms = uomsRes.data; depts = deptsRes.data;
    renderItems(); populateItemPickers();
    await loadStructureBoms();
    if (structureSelectedItemId) renderStructureTree();
    await loadMoList();
    await loadShopfloorMoList();
    await loadStockBalances();
  } catch (error) { toast(cloudError(error)); }
}

// Mirrors the DB check constraints on mst_items (code/name/name_en): must not
// start with a symbol, must not contain \ or ' — the legacy form's own
// warning box. Checked client-side too so the user sees a Thai message
// instead of a raw Postgres constraint-violation error.
function badNameOrCode(value, label) {
  if (!value) return null;
  if (/[\\']/.test(value)) return `${label} ห้ามมีสัญลักษณ์ \\ หรือ '`;
  if (!/^[A-Za-z0-9ก-๙]/.test(value)) return `${label} ห้ามขึ้นต้นด้วยสัญลักษณ์`;
  return null;
}

function numOrNull(id) {
  const v = $(id).value;
  return v === '' ? null : Number(v);
}

function textOrNull(id) {
  const v = $(id).value.trim();
  return v === '' ? null : v;
}

// ---- inline BOM/Routing rows on the item form -----------------------------
// Lets a new FG item's materials and process steps be entered in the same
// form instead of requiring a separate trip to the "วาง BOM"/"วาง Routing"
// cards; on submit these become that item's first BOM/Routing version.
function newSelect(className) { const el = document.createElement('select'); el.className = className; return el; }
function newInput(className, attrs) { const el = document.createElement('input'); el.className = className; Object.assign(el, attrs); return el; }

function addLineRow(container, rowClass, fields) {
  const row = document.createElement('div');
  row.className = rowClass;
  for (const field of fields) row.append(field);
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'row-remove'; remove.textContent = 'ลบ';
  remove.addEventListener('click', () => row.remove());
  row.append(remove);
  container.append(row);
}

function addBomRow() {
  const component = newSelect('bom-row-component');
  options(component, items, i => i.id, itemLabel, '— เลือกวัตถุดิบ —');
  const qty = newInput('bom-row-qty', {type: 'number', min: '0', step: 'any', placeholder: 'จำนวนต่อหน่วย'});
  const scrap = newInput('bom-row-scrap', {type: 'number', min: '0', max: '100', step: 'any', placeholder: 'สูญเสีย %', value: '0'});
  const dept = newSelect('bom-row-dept');
  options(dept, depts, d => d.code, deptLabel, '— แผนกที่ใช้ —');
  addLineRow($('#item-bom-rows'), 'line-row', [component, qty, scrap, dept]);
}

function addRoutingRow() {
  const dept = newSelect('routing-row-dept');
  options(dept, depts, d => d.code, deptLabel, '— แผนก —');
  const target = newInput('routing-row-target', {type: 'number', min: '0', step: 'any', placeholder: 'เป้าหมาย/ชั่วโมง'});
  const setup = newInput('routing-row-setup', {type: 'number', min: '0', step: 'any', placeholder: 'เวลาติดตั้ง (นาที)', value: '0'});
  addLineRow($('#item-routing-rows'), 'line-row routing-row', [dept, target, setup]);
}

function resetLineRows() {
  $('#item-bom-rows').replaceChildren(); addBomRow();
  $('#item-routing-rows').replaceChildren(); addRoutingRow();
}

function toggleItemLineFieldsets() {
  const isFg = $('#item-type').value === 'FG';
  $('#item-bom-fieldset').hidden = !isFg;
  $('#item-routing-fieldset').hidden = !isFg;
}

function collectBomRows() {
  return [...document.querySelectorAll('#item-bom-rows .line-row')].map(row => ({
    component: row.querySelector('.bom-row-component').value,
    qty: row.querySelector('.bom-row-qty').value,
    scrap: row.querySelector('.bom-row-scrap').value,
    dept: row.querySelector('.bom-row-dept').value
  })).filter(r => r.component && r.qty !== '');
}

function collectRoutingRows() {
  return [...document.querySelectorAll('#item-routing-rows .line-row')].map(row => ({
    dept: row.querySelector('.routing-row-dept').value,
    target: row.querySelector('.routing-row-target').value,
    setup: row.querySelector('.routing-row-setup').value
  })).filter(r => r.dept && r.target !== '');
}

$('#item-bom-add').addEventListener('click', addBomRow);
$('#item-routing-add').addEventListener('click', addRoutingRow);
$('#item-type').addEventListener('change', toggleItemLineFieldsets);
$('#item-form').addEventListener('reset', resetLineRows);

$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const nameTh = $('#item-name').value.trim();
  const nameEn = $('#item-name-en').value.trim();
  const code = $('#item-code').value.trim();
  const badField = badNameOrCode(nameTh, 'ชื่อไทย') || badNameOrCode(nameEn, 'ชื่ออังกฤษ') || badNameOrCode(code, 'รหัส');
  if (badField) { $('#item-status').textContent = badField; toast(badField); return; }

  const isFg = $('#item-type').value === 'FG';
  const bomRows = isFg ? collectBomRows() : [];
  const routingRows = isFg ? collectRoutingRows() : [];

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true; $('#item-status').textContent = 'กำลังบันทึก…';
  try {
    const dimUom = $('#item-dim-uom').value;
    const weightUom = $('#item-weight-uom').value;
    const {data: newItem, error} = await client.from('mst_items').insert({
      code,
      name: nameTh,
      name_en: nameEn,
      code_secondary: textOrNull('#item-code-secondary'),
      barcode: textOrNull('#item-barcode'),
      item_type: $('#item-type').value,
      uom_code: $('#item-uom').value,
      uom_secondary_code: $('#item-uom-secondary').value || null,
      uom_secondary_qty: numOrNull('#item-uom-secondary-qty'),
      item_class: textOrNull('#item-class'),
      item_subtype: textOrNull('#item-subtype'),
      item_group: textOrNull('#item-group'),
      standard_cost: Number($('#item-cost').value) || 0,
      sales_price: Number($('#item-price').value) || 0,
      description: textOrNull('#item-description'),
      shape: textOrNull('#item-shape'),
      dim_length: numOrNull('#item-dim-length'), dim_length_uom: dimUom,
      dim_width: numOrNull('#item-dim-width'), dim_width_uom: dimUom,
      dim_thickness: numOrNull('#item-dim-thickness'), dim_thickness_uom: dimUom,
      dim_height: numOrNull('#item-dim-height'), dim_height_uom: dimUom,
      size_value: numOrNull('#item-size'), size_uom: dimUom,
      volume: numOrNull('#item-volume'), volume_uom: $('#item-volume-uom').value,
      process_time_min: numOrNull('#item-process-time'),
      weight_min: numOrNull('#item-weight-min'),
      weight_per_piece: numOrNull('#item-weight-per-piece'), weight_per_piece_uom: weightUom,
      weight_max: numOrNull('#item-weight-max'),
      scrap_qty: numOrNull('#item-scrap-qty'),
      valid_from: $('#item-valid-from').value || null,
      valid_to: $('#item-valid-to').value || null
    }).select('id').single();
    if (error) throw error;

    // The item itself already exists at this point — a BOM/Routing insert
    // failing below leaves the item behind without them, same known gap as
    // the rest of this module until a real service layer exists (see
    // docs/DATA-LAYER.md). The status line says which step failed so the
    // missing BOM/Routing can be added by hand via the cards below meanwhile.
    if (bomRows.length) {
      $('#item-status').textContent = 'บันทึกสินค้าแล้ว กำลังสร้าง BOM…';
      const {data: bom, error: bomError} = await client.from('prod_boms')
        .insert({item_id: newItem.id, version: 'BOM-01'}).select('id').single();
      if (bomError) throw bomError;
      const lines = bomRows.map(r => ({
        bom_id: bom.id, component_item_id: r.component,
        qty_per_unit: Number(r.qty), scrap_pct: (Number(r.scrap) || 0) / 100,
        dept_code: r.dept || null
      }));
      const {error: linesError} = await client.from('prod_bom_lines').insert(lines);
      if (linesError) throw linesError;
    }

    if (routingRows.length) {
      $('#item-status').textContent = 'บันทึกสินค้าแล้ว กำลังสร้าง Routing…';
      const {data: routing, error: routingError} = await client.from('prod_routings')
        .insert({item_id: newItem.id, version: 'R-01'}).select('id').single();
      if (routingError) throw routingError;
      const steps = routingRows.map((r, index) => ({
        routing_id: routing.id, seq: (index + 1) * 10,
        dept_code: r.dept, target_per_hour: Number(r.target), setup_minutes: Number(r.setup) || 0
      }));
      const {error: stepsError} = await client.from('prod_routing_steps').insert(steps);
      if (stepsError) throw stepsError;
    }

    event.target.reset();
    const extra = [bomRows.length && 'BOM', routingRows.length && 'Routing'].filter(Boolean).join(' + ');
    const message = extra ? `เพิ่มสินค้าแล้ว พร้อม ${extra} เวอร์ชันแรก` : 'เพิ่มสินค้าแล้ว';
    $('#item-status').textContent = message;
    toast(message);
    await loadMaster();
  } catch (error) { $('#item-status').textContent = cloudError(error); }
  finally { button.disabled = false; }
});

// ---- Product structure (Class/Type/Group search + multi-level BOM tree) ---
// There is no separate "structure" table: a node's children are simply its
// item's own prod_boms/prod_bom_lines (the same tables the flat "วาง BOM"
// card above uses), walked recursively component-by-component. This mirrors
// the legacy Ari/Hawaii "โครงสร้างสินค้า" screen's tree without new schema.
function itemLabelFull(item) { return `${item.code} — ${item.name}`; }

async function loadStructureBoms() {
  try {
    const [bomsRes, linesRes] = await Promise.all([
      client.from('prod_boms').select('id,item_id,version,is_active,created_at').order('created_at', {ascending: false}),
      client.from('prod_bom_lines').select('id,bom_id,component_item_id,qty_per_unit,scrap_pct,dept_code')
    ]);
    if (bomsRes.error) throw bomsRes.error;
    if (linesRes.error) throw linesRes.error;
    structureBoms = bomsRes.data; structureBomLines = linesRes.data;
  } catch (error) { toast(cloudError(error)); structureBoms = []; structureBomLines = []; }
}

function activeBomForItem(itemId) {
  const candidates = structureBoms.filter(b => b.item_id === itemId);
  return candidates.find(b => b.is_active) || candidates[0] || null;
}

function linesForBom(bomId) { return structureBomLines.filter(l => l.bom_id === bomId); }

// BFS down the BOM tree: true if toItemId is fromItemId itself or one of its
// components at any depth. Used to block operations that would create a
// structure cycle (attaching an item under one of its own descendants).
function itemReachable(fromItemId, toItemId) {
  const seen = new Set(); const queue = [fromItemId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toItemId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const bom = activeBomForItem(id);
    if (!bom) continue;
    for (const line of linesForBom(bom.id)) queue.push(line.component_item_id);
  }
  return false;
}

function buildStructureNode(itemId, bomLineId, qtyPerUnit, scrapPct, deptCode, ancestors) {
  const item = items.find(i => i.id === itemId);
  const node = {itemId, item, bomLineId, qtyPerUnit, scrapPct, deptCode, children: [], cyclic: ancestors.has(itemId)};
  if (node.cyclic) return node;
  const bom = activeBomForItem(itemId);
  if (bom) {
    const nextAncestors = new Set(ancestors); nextAncestors.add(itemId);
    for (const line of linesForBom(bom.id)) {
      node.children.push(buildStructureNode(line.component_item_id, line.id, Number(line.qty_per_unit), Number(line.scrap_pct), line.dept_code, nextAncestors));
    }
  }
  return node;
}

function renderTreeNode(node, path) {
  const nodePath = [...path, node.itemId];
  const container = document.createElement('div');
  container.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row';
  if (node.bomLineId && structureClipboard?.bomLineId === node.bomLineId) row.classList.add('cut');
  row.dataset.itemId = node.itemId;
  if (node.bomLineId) row.dataset.bomLineId = node.bomLineId;
  row.dataset.path = nodePath.join(',');

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = node.children.length ? '▾' : '';
  row.append(toggle);

  const code = document.createElement('span'); code.className = 'tree-code'; code.textContent = node.item?.code ?? node.itemId;
  const name = document.createElement('span'); name.className = 'tree-name';
  name.textContent = node.cyclic ? `${node.item?.name ?? ''} (โครงสร้างวนกลับ — ข้าม)` : (node.item?.name ?? '');
  const qty = document.createElement('span'); qty.className = 'tree-qty';
  if (node.bomLineId) {
    const scrapText = node.scrapPct ? ` (สูญเสีย ${(node.scrapPct * 100).toLocaleString('th-TH')}%)` : '';
    qty.textContent = `${node.qtyPerUnit} ${node.item?.uom_code ?? ''}${scrapText}`;
  }
  row.append(code, name, qty);
  container.append(row);

  if (node.children.length && !node.cyclic) {
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    for (const child of node.children) childWrap.append(renderTreeNode(child, nodePath));
    container.append(childWrap);
    toggle.addEventListener('click', () => { childWrap.hidden = !childWrap.hidden; toggle.textContent = childWrap.hidden ? '▸' : '▾'; });
  }
  return container;
}

function renderStructureTree() {
  const wrap = $('#structure-tree-wrap');
  if (!structureSelectedItemId) { wrap.replaceChildren(); return; }
  const tree = buildStructureNode(structureSelectedItemId, null, 1, 0, null, new Set());
  wrap.replaceChildren(renderTreeNode(tree, []));
}

// ---- Class/Type/Group cascading search ------------------------------------
function distinctValues(rows, key, filter) {
  const set = new Set();
  for (const row of rows) { if (filter && !filter(row)) continue; if (row[key]) set.add(row[key]); }
  return [...set].sort((a, b) => a.localeCompare(b, 'th'));
}

function refreshStructureClassOptions() {
  options($('#structure-filter-class'), distinctValues(items, 'item_class').map(v => ({v})), r => r.v, r => r.v, 'ทั้งหมด');
}
function refreshStructureSubtypeOptions() {
  const cls = $('#structure-filter-class').value;
  options($('#structure-filter-subtype'), distinctValues(items, 'item_subtype', i => !cls || i.item_class === cls).map(v => ({v})), r => r.v, r => r.v, 'ทั้งหมด');
}
function refreshStructureGroupOptions() {
  const cls = $('#structure-filter-class').value, subtype = $('#structure-filter-subtype').value;
  const filter = i => (!cls || i.item_class === cls) && (!subtype || i.item_subtype === subtype);
  options($('#structure-filter-group'), distinctValues(items, 'item_group', filter).map(v => ({v})), r => r.v, r => r.v, 'ทั้งหมด');
}
function refreshStructureFilterOptions() {
  const cls = $('#structure-filter-class').value, subtype = $('#structure-filter-subtype').value, group = $('#structure-filter-group').value;
  refreshStructureClassOptions(); refreshStructureSubtypeOptions(); refreshStructureGroupOptions();
  $('#structure-filter-class').value = cls; $('#structure-filter-subtype').value = subtype; $('#structure-filter-group').value = group;
}

function renderStructureSearchResults(rows) {
  const wrap = $('#structure-search-wrap');
  $('#structure-search-count').textContent = rows.length ? `${rows.length} รายการ` : '';
  if (!rows.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ไม่พบสินค้าตามเงื่อนไข'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['รหัส', 'ชื่อไทย', 'ชื่ออังกฤษ', 'คลาส', 'ไทป์', 'กรุ๊ป', 'ประเภท']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const item of rows) {
    const tr = body.insertRow();
    tr.dataset.itemId = item.id;
    if (item.id === structureSelectedItemId) tr.classList.add('selected');
    tr.insertCell().textContent = item.code;
    tr.insertCell().textContent = item.name;
    tr.insertCell().textContent = item.name_en || '';
    tr.insertCell().textContent = item.item_class || '';
    tr.insertCell().textContent = item.item_subtype || '';
    tr.insertCell().textContent = item.item_group || '';
    tr.insertCell().textContent = item.item_type;
  }
  wrap.replaceChildren(table);
}

function runStructureSearch() {
  const cls = $('#structure-filter-class').value, subtype = $('#structure-filter-subtype').value, group = $('#structure-filter-group').value;
  const text = $('#structure-filter-text').value.trim().toLowerCase();
  const rows = items.filter(i =>
    (!cls || i.item_class === cls) &&
    (!subtype || i.item_subtype === subtype) &&
    (!group || i.item_group === group) &&
    (!text || i.code.toLowerCase().includes(text) || i.name.toLowerCase().includes(text) || (i.name_en || '').toLowerCase().includes(text))
  );
  renderStructureSearchResults(rows);
}

function selectStructureItem(itemId) {
  structureSelectedItemId = itemId;
  structureClipboard = null;
  const item = items.find(i => i.id === itemId);
  $('#structure-tree-section').hidden = false;
  $('#structure-tree-title').textContent = item ? `โครงสร้าง: ${itemLabelFull(item)}` : '';
  $('#structure-search-wrap').querySelectorAll('tr[data-item-id]').forEach(tr => tr.classList.toggle('selected', tr.dataset.itemId === itemId));
  renderStructureTree();
}

$('#structure-filter-class').addEventListener('change', () => { refreshStructureSubtypeOptions(); refreshStructureGroupOptions(); runStructureSearch(); });
$('#structure-filter-subtype').addEventListener('change', () => { refreshStructureGroupOptions(); runStructureSearch(); });
$('#structure-filter-group').addEventListener('change', runStructureSearch);
$('#structure-search-btn').addEventListener('click', runStructureSearch);
$('#structure-filter-text').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runStructureSearch(); } });
$('#structure-search-clear').addEventListener('click', () => {
  $('#structure-filter-class').value = ''; $('#structure-filter-subtype').value = ''; $('#structure-filter-group').value = ''; $('#structure-filter-text').value = '';
  refreshStructureSubtypeOptions(); refreshStructureGroupOptions();
  runStructureSearch();
});
$('#structure-search-wrap').addEventListener('click', event => {
  const tr = event.target.closest('tr[data-item-id]');
  if (!tr) return;
  selectStructureItem(tr.dataset.itemId);
});
$('#structure-tree-refresh').addEventListener('click', async () => { await loadStructureBoms(); renderStructureTree(); });

// ---- Right-click context menu on the structure tree ------------------------
async function ensureBomForItem(itemId) {
  const existing = activeBomForItem(itemId);
  if (existing) return existing.id;
  const {data, error} = await client.from('prod_boms').insert({item_id: itemId, version: 'BOM-01'})
    .select('id,item_id,version,is_active,created_at').single();
  if (error) throw error;
  structureBoms.push(data);
  return data.id;
}

// Items that can legally become a component under targetItemId: not the
// target itself, and not an ancestor of it (that would close a loop).
function structureComponentCandidates(targetItemId) {
  return items.filter(i => i.id !== targetItemId && !itemReachable(i.id, targetItemId));
}

function openStructureLineDialog(mode) {
  structureDialogMode = mode;
  const componentSelect = $('#structure-line-component');
  options($('#structure-line-dept'), depts, d => d.code, deptLabel, '— ไม่ระบุแผนก —');
  if (mode.type === 'add') {
    const target = items.find(i => i.id === mode.targetItemId);
    $('#structure-line-title').textContent = 'เพิ่มโครงสร้างย่อย';
    $('#structure-line-note').textContent = target ? `เพิ่มชิ้นส่วนภายใต้ ${itemLabelFull(target)}` : '';
    componentSelect.disabled = false;
    options(componentSelect, structureComponentCandidates(mode.targetItemId), i => i.id, itemLabelFull, '— เลือกสินค้า/ชิ้นส่วน —');
    $('#structure-line-qty').value = '1';
    $('#structure-line-scrap').value = '0';
    $('#structure-line-dept').value = '';
  } else {
    const line = structureBomLines.find(l => l.id === mode.bomLineId);
    const component = items.find(i => i.id === line?.component_item_id);
    $('#structure-line-title').textContent = 'แก้ไขจำนวน/สูญเสีย';
    $('#structure-line-note').textContent = component ? itemLabelFull(component) : '';
    componentSelect.disabled = true;
    options(componentSelect, component ? [component] : [], i => i.id, itemLabelFull);
    if (component) componentSelect.value = component.id;
    $('#structure-line-qty').value = line?.qty_per_unit ?? '';
    $('#structure-line-scrap').value = line ? Number(line.scrap_pct) * 100 : '0';
    $('#structure-line-dept').value = line?.dept_code || '';
  }
  $('#structure-line-dialog').showModal();
}

$('#structure-line-form').addEventListener('submit', async event => {
  event.preventDefault();
  const dialog = $('#structure-line-dialog');
  if (event.submitter?.value !== 'ok') { dialog.close(); structureDialogMode = null; return; }
  const mode = structureDialogMode;
  const qty = Number($('#structure-line-qty').value);
  const scrap = (Number($('#structure-line-scrap').value) || 0) / 100;
  const dept = $('#structure-line-dept').value || null;
  if (!mode || !Number.isFinite(qty) || qty <= 0) { toast('จำนวนต่อหน่วยต้องมากกว่าศูนย์'); return; }
  try {
    if (mode.type === 'add') {
      const componentId = $('#structure-line-component').value;
      if (!componentId) { toast('เลือกสินค้า/ชิ้นส่วนก่อน'); return; }
      const bomId = await ensureBomForItem(mode.targetItemId);
      const {data, error} = await client.from('prod_bom_lines')
        .insert({bom_id: bomId, component_item_id: componentId, qty_per_unit: qty, scrap_pct: scrap, dept_code: dept})
        .select('id,bom_id,component_item_id,qty_per_unit,scrap_pct,dept_code').single();
      if (error) throw error;
      structureBomLines.push(data);
      toast('เพิ่มโครงสร้างย่อยแล้ว');
    } else {
      const {error} = await client.from('prod_bom_lines')
        .update({qty_per_unit: qty, scrap_pct: scrap, dept_code: dept}).eq('id', mode.bomLineId);
      if (error) throw error;
      const line = structureBomLines.find(l => l.id === mode.bomLineId);
      if (line) { line.qty_per_unit = qty; line.scrap_pct = scrap; line.dept_code = dept; }
      toast('บันทึกการแก้ไขแล้ว');
    }
    dialog.close(); structureDialogMode = null;
    renderStructureTree();
  } catch (error) { toast(cloudError(error)); }
});

async function handleStructureCtxAction(action, node) {
  if (action === 'add') { openStructureLineDialog({type: 'add', targetItemId: node.itemId}); return; }
  if (action === 'edit') { if (node.bomLineId) openStructureLineDialog({type: 'edit', bomLineId: node.bomLineId}); return; }

  if (action === 'cut') {
    if (!node.bomLineId) return;
    const line = structureBomLines.find(l => l.id === node.bomLineId);
    if (!line) return;
    structureClipboard = {bomLineId: line.id, componentItemId: line.component_item_id, qtyPerUnit: line.qty_per_unit, scrapPct: line.scrap_pct, deptCode: line.dept_code};
    toast('ตัดชิ้นส่วนแล้ว — คลิกขวาที่จุดปลายทางแล้วเลือก "วาง"');
    renderStructureTree();
    return;
  }

  if (action === 'paste') {
    if (!structureClipboard) return;
    try {
      const bomId = await ensureBomForItem(node.itemId);
      const {data, error} = await client.from('prod_bom_lines')
        .insert({bom_id: bomId, component_item_id: structureClipboard.componentItemId, qty_per_unit: structureClipboard.qtyPerUnit, scrap_pct: structureClipboard.scrapPct, dept_code: structureClipboard.deptCode})
        .select('id,bom_id,component_item_id,qty_per_unit,scrap_pct,dept_code').single();
      if (error) throw error;
      const {error: delError} = await client.from('prod_bom_lines').delete().eq('id', structureClipboard.bomLineId);
      if (delError) throw delError;
      structureBomLines = structureBomLines.filter(l => l.id !== structureClipboard.bomLineId);
      structureBomLines.push(data);
      structureClipboard = null;
      toast('ย้ายโครงสร้างแล้ว');
      renderStructureTree();
    } catch (error) { toast(cloudError(error)); }
    return;
  }

  if (action === 'delete') {
    if (!node.bomLineId) return;
    const line = structureBomLines.find(l => l.id === node.bomLineId);
    const component = items.find(i => i.id === line?.component_item_id);
    if (!confirm(`ลบ "${component ? itemLabelFull(component) : ''}" ออกจากโครงสร้างนี้? (ตัวสินค้าเองและโครงสร้างย่อยของมันจะไม่ถูกลบ)`)) return;
    try {
      const {error} = await client.from('prod_bom_lines').delete().eq('id', node.bomLineId);
      if (error) throw error;
      structureBomLines = structureBomLines.filter(l => l.id !== node.bomLineId);
      if (structureClipboard?.bomLineId === node.bomLineId) structureClipboard = null;
      toast('ลบแล้ว');
      renderStructureTree();
    } catch (error) { toast(cloudError(error)); }
  }
}

// Fixed-position menu: an ancestor/page scroll never moves it off the
// pointer, so only close on an outside click (closing on 'scroll' too was
// tried and reverted — a layout shift from the menu's own insertion can
// itself trigger a scroll adjustment, closing the menu a tick after it opens).
function closeStructureCtxMenu() { $('#structure-ctx-menu').hidden = true; }
document.addEventListener('click', closeStructureCtxMenu);

$('#structure-tree-wrap').addEventListener('contextmenu', event => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  event.preventDefault();
  const node = {itemId: row.dataset.itemId, bomLineId: row.dataset.bomLineId || null};
  const isRoot = !node.bomLineId;
  const canPaste = !!structureClipboard
    && structureClipboard.componentItemId !== node.itemId
    && structureClipboard.bomLineId !== node.bomLineId
    && !itemReachable(structureClipboard.componentItemId, node.itemId);

  const menu = $('#structure-ctx-menu');
  const menuItems = [
    {label: '➕ เพิ่มโครงสร้างย่อย', action: 'add', disabled: false},
    {label: '✏️ แก้ไขจำนวน/สูญเสีย', action: 'edit', disabled: isRoot},
    {label: '✂️ ตัด', action: 'cut', disabled: isRoot},
    {label: '📋 วาง', action: 'paste', disabled: !canPaste},
    {label: '🗑 ลบ', action: 'delete', disabled: isRoot, danger: true}
  ];
  menu.replaceChildren();
  for (const mi of menuItems) {
    const li = document.createElement('li');
    li.textContent = mi.label;
    if (mi.disabled) {
      li.setAttribute('aria-disabled', 'true');
    } else {
      if (mi.danger) li.classList.add('danger');
      li.addEventListener('click', () => { menu.hidden = true; handleStructureCtxAction(mi.action, node); });
    }
    menu.append(li);
  }
  menu.hidden = false;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, vw - rect.width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, vh - rect.height - 8))}px`;
});

// ---- Stock balances ---------------------------------------------------------
function renderStockBalances(rows) {
  const wrap = $('#stock-wrap');
  $('#stock-count').textContent = rows.length ? `${rows.length} รายการ` : '';
  if (!rows.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่มีข้อมูลสต็อก'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['รหัสสินค้า', 'ชื่อ', 'คลัง', 'จำนวนคงเหลือ', 'ต้นทุนเฉลี่ย']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    const item = row.mst_items;
    tr.insertCell().textContent = item?.code ?? row.item_id;
    tr.insertCell().textContent = item?.name ?? '-';
    tr.insertCell().textContent = row.warehouse_code;
    tr.insertCell().textContent = Number(row.qty_on_hand).toLocaleString('th-TH');
    tr.insertCell().textContent = Number(row.avg_cost).toLocaleString('th-TH');
  }
  wrap.replaceChildren(table);
}

async function loadStockBalances() {
  try {
    const {data, error} = await client.from('inv_stock_balances')
      .select('item_id,warehouse_code,qty_on_hand,avg_cost,mst_items(code,name)')
      .order('warehouse_code');
    if (error) throw error;
    renderStockBalances(data);
  } catch (error) { toast(cloudError(error)); }
}

// ---- BOM ------------------------------------------------------------------
function renderBomLines() {
  const wrap = $('#bom-lines-wrap');
  $('#line-submit').disabled = !currentBomId;
  if (!currentBomId) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่ได้เลือกเวอร์ชัน BOM'}));
    return;
  }
  if (!bomLines.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'BOM เวอร์ชันนี้ยังไม่มีรายการ'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['วัตถุดิบ/ชิ้นส่วน', 'จำนวนต่อหน่วย', 'สูญเสีย (%)', 'แผนก', '']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const line of bomLines) {
    const tr = body.insertRow();
    const component = line.mst_items;
    tr.insertCell().textContent = component ? itemLabel(component) : line.component_item_id;
    tr.insertCell().textContent = line.qty_per_unit;
    tr.insertCell().textContent = (Number(line.scrap_pct) * 100).toLocaleString('th-TH');
    tr.insertCell().textContent = line.dept_code ? deptLabel({code: line.dept_code, name: depts.find(d => d.code === line.dept_code)?.name}) : '-';
    const act = tr.insertCell();
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = 'ลบ'; del.dataset.lineId = line.id;
    act.append(del);
  }
  wrap.replaceChildren(table);
}

async function loadBomVersions(itemId) {
  $('#bom-version').replaceChildren();
  currentBomId = null; bomLines = [];
  if (!itemId) { renderBomLines(); return; }
  try {
    const {data, error} = await client.from('prod_boms')
      .select('id,version,created_at').eq('item_id', itemId).order('created_at', {ascending: false});
    if (error) throw error;
    options($('#bom-version'), data, b => b.id, b => b.version, data.length ? undefined : '— ยังไม่มีเวอร์ชัน —');
    $('#bom-status').textContent = data.length ? `${data.length} เวอร์ชัน` : 'สินค้านี้ยังไม่มี BOM — สร้างเวอร์ชันใหม่ได้เลย';
    currentBomId = data[0]?.id ?? null;
    await loadBomLines();
  } catch (error) { $('#bom-status').textContent = cloudError(error); }
}

async function loadBomLines() {
  if (!currentBomId) { renderBomLines(); return; }
  try {
    const {data, error} = await client.from('prod_bom_lines')
      .select('id,qty_per_unit,scrap_pct,dept_code,component_item_id,mst_items(code,name)')
      .eq('bom_id', currentBomId);
    if (error) throw error;
    bomLines = data;
  } catch (error) { toast(cloudError(error)); bomLines = []; }
  renderBomLines();
}

$('#bom-item').addEventListener('change', () => loadBomVersions($('#bom-item').value));
$('#bom-version').addEventListener('change', () => { currentBomId = $('#bom-version').value || null; loadBomLines(); });

$('#bom-new-version').addEventListener('click', async () => {
  const itemId = $('#bom-item').value;
  const version = $('#bom-new-version-text').value.trim();
  if (!itemId) { toast('เลือกสินค้า FG ก่อน'); return; }
  if (!version) { toast('กรอกชื่อเวอร์ชันก่อน'); return; }
  $('#bom-new-version').disabled = true;
  try {
    const {data, error} = await client.from('prod_boms').insert({item_id: itemId, version}).select('id').single();
    if (error) throw error;
    $('#bom-new-version-text').value = '';
    toast(`สร้างเวอร์ชัน ${version} แล้ว`);
    await loadBomVersions(itemId);
    $('#bom-version').value = data.id;
    currentBomId = data.id;
    await loadBomLines();
  } catch (error) { toast(cloudError(error)); }
  finally { $('#bom-new-version').disabled = false; }
});

$('#line-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentBomId) return;
  const button = $('#line-submit');
  button.disabled = true; $('#line-status').textContent = 'กำลังบันทึก…';
  try {
    const {error} = await client.from('prod_bom_lines').insert({
      bom_id: currentBomId,
      component_item_id: $('#line-component').value,
      qty_per_unit: Number($('#line-qty').value),
      scrap_pct: (Number($('#line-scrap').value) || 0) / 100,
      dept_code: $('#line-dept').value || null
    });
    if (error) throw error;
    $('#line-qty').value = ''; $('#line-scrap').value = '0';
    $('#line-status').textContent = 'เพิ่มรายการแล้ว';
    toast('เพิ่มรายการเข้า BOM แล้ว');
    await loadBomLines();
  } catch (error) { $('#line-status').textContent = cloudError(error); }
  finally { button.disabled = !currentBomId; }
});

$('#bom-lines-wrap').addEventListener('click', async event => {
  const button = event.target.closest('button[data-line-id]');
  if (!button) return;
  button.disabled = true;
  try {
    const {error} = await client.from('prod_bom_lines').delete().eq('id', button.dataset.lineId);
    if (error) throw error;
    toast('ลบรายการแล้ว');
    await loadBomLines();
  } catch (error) { toast(cloudError(error)); button.disabled = false; }
});

// ---- Routing ----------------------------------------------------------------
function renderRoutingSteps() {
  const wrap = $('#routing-steps-wrap');
  $('#step-submit').disabled = !currentRoutingId;
  if (!currentRoutingId) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่ได้เลือกเวอร์ชัน Routing'}));
    return;
  }
  if (!routingSteps.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'Routing เวอร์ชันนี้ยังไม่มี step'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['ลำดับ', 'แผนก', 'เป้าหมาย/ชั่วโมง', 'เวลาติดตั้ง (นาที)', '']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const step of routingSteps) {
    const tr = body.insertRow();
    tr.insertCell().textContent = step.seq;
    tr.insertCell().textContent = deptLabel({code: step.dept_code, name: depts.find(d => d.code === step.dept_code)?.name});
    tr.insertCell().textContent = step.target_per_hour;
    tr.insertCell().textContent = step.setup_minutes;
    const act = tr.insertCell();
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = 'ลบ'; del.dataset.stepId = step.id;
    act.append(del);
  }
  wrap.replaceChildren(table);
}

async function loadRoutingVersions(itemId) {
  $('#routing-version').replaceChildren();
  currentRoutingId = null; routingSteps = [];
  if (!itemId) { renderRoutingSteps(); return; }
  try {
    const {data, error} = await client.from('prod_routings')
      .select('id,version,created_at').eq('item_id', itemId).order('created_at', {ascending: false});
    if (error) throw error;
    options($('#routing-version'), data, r => r.id, r => r.version, data.length ? undefined : '— ยังไม่มีเวอร์ชัน —');
    $('#routing-status').textContent = data.length ? `${data.length} เวอร์ชัน` : 'สินค้านี้ยังไม่มี Routing — สร้างเวอร์ชันใหม่ได้เลย';
    currentRoutingId = data[0]?.id ?? null;
    await loadRoutingSteps();
  } catch (error) { $('#routing-status').textContent = cloudError(error); }
}

async function loadRoutingSteps() {
  if (!currentRoutingId) { renderRoutingSteps(); return; }
  try {
    const {data, error} = await client.from('prod_routing_steps')
      .select('id,seq,dept_code,target_per_hour,setup_minutes')
      .eq('routing_id', currentRoutingId).order('seq');
    if (error) throw error;
    routingSteps = data;
  } catch (error) { toast(cloudError(error)); routingSteps = []; }
  renderRoutingSteps();
}

$('#routing-item').addEventListener('change', () => loadRoutingVersions($('#routing-item').value));
$('#routing-version').addEventListener('change', () => { currentRoutingId = $('#routing-version').value || null; loadRoutingSteps(); });

$('#routing-new-version').addEventListener('click', async () => {
  const itemId = $('#routing-item').value;
  const version = $('#routing-new-version-text').value.trim();
  if (!itemId) { toast('เลือกสินค้า FG ก่อน'); return; }
  if (!version) { toast('กรอกชื่อเวอร์ชันก่อน'); return; }
  $('#routing-new-version').disabled = true;
  try {
    const {data, error} = await client.from('prod_routings').insert({item_id: itemId, version}).select('id').single();
    if (error) throw error;
    $('#routing-new-version-text').value = '';
    toast(`สร้างเวอร์ชัน ${version} แล้ว`);
    await loadRoutingVersions(itemId);
    $('#routing-version').value = data.id;
    currentRoutingId = data.id;
    await loadRoutingSteps();
  } catch (error) { toast(cloudError(error)); }
  finally { $('#routing-new-version').disabled = false; }
});

$('#step-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentRoutingId) return;
  const button = $('#step-submit');
  button.disabled = true; $('#step-status').textContent = 'กำลังบันทึก…';
  try {
    const {error} = await client.from('prod_routing_steps').insert({
      routing_id: currentRoutingId,
      seq: Number($('#step-seq').value),
      dept_code: $('#step-dept').value,
      target_per_hour: Number($('#step-target').value),
      setup_minutes: Number($('#step-setup').value) || 0
    });
    if (error) throw error;
    $('#step-seq').value = ''; $('#step-target').value = ''; $('#step-setup').value = '0';
    $('#step-status').textContent = 'เพิ่ม step แล้ว';
    toast('เพิ่ม step เข้า Routing แล้ว');
    await loadRoutingSteps();
  } catch (error) { $('#step-status').textContent = cloudError(error); }
  finally { button.disabled = !currentRoutingId; }
});

$('#routing-steps-wrap').addEventListener('click', async event => {
  const button = event.target.closest('button[data-step-id]');
  if (!button) return;
  button.disabled = true;
  try {
    const {error} = await client.from('prod_routing_steps').delete().eq('id', button.dataset.stepId);
    if (error) throw error;
    toast('ลบ step แล้ว');
    await loadRoutingSteps();
  } catch (error) { toast(cloudError(error)); button.disabled = false; }
});

// ---- Manufacturing orders -----------------------------------------------------
function moStatusLabel(status) {
  return {DRAFT: 'ร่าง', RELEASED: 'ปล่อยงานแล้ว', IN_PROGRESS: 'กำลังผลิต', DONE: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก'}[status] ?? status;
}

function renderMoList(rows) {
  const wrap = $('#mo-list-wrap');
  if (!rows.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ยังไม่มีใบสั่งผลิต'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['เลขที่', 'สินค้า', 'จำนวน', 'สถานะ', 'กำหนดส่ง']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const mo of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = mo.doc_no;
    tr.insertCell().textContent = mo.mst_items ? itemLabel(mo.mst_items) : mo.item_id;
    tr.insertCell().textContent = mo.qty;
    tr.insertCell().textContent = moStatusLabel(mo.status);
    tr.insertCell().textContent = mo.due_date ?? '-';
  }
  wrap.replaceChildren(table);
}

async function loadMoList() {
  try {
    const {data, error} = await client.from('prod_manufacturing_orders')
      .select('doc_no,item_id,qty,status,due_date,created_at,mst_items(code,name)')
      .order('created_at', {ascending: false}).limit(50);
    if (error) throw error;
    renderMoList(data);
  } catch (error) { toast(cloudError(error)); }
}

async function loadMoPickers(itemId) {
  $('#mo-bom').replaceChildren(); $('#mo-routing').replaceChildren();
  $('#mo-submit').disabled = true;
  if (!itemId) return;
  try {
    const [bomsRes, routingsRes] = await Promise.all([
      client.from('prod_boms').select('id,version').eq('item_id', itemId).order('created_at', {ascending: false}),
      client.from('prod_routings').select('id,version').eq('item_id', itemId).order('created_at', {ascending: false})
    ]);
    if (bomsRes.error) throw bomsRes.error;
    if (routingsRes.error) throw routingsRes.error;
    options($('#mo-bom'), bomsRes.data, b => b.id, b => b.version, bomsRes.data.length ? undefined : '— ยังไม่มี BOM —');
    options($('#mo-routing'), routingsRes.data, r => r.id, r => r.version, routingsRes.data.length ? undefined : '— ยังไม่มี Routing —');
    $('#mo-status').textContent = (bomsRes.data.length && routingsRes.data.length)
      ? '' : 'สินค้านี้ต้องมีทั้ง BOM และ Routing ก่อนเปิดใบสั่งผลิต';
    $('#mo-submit').disabled = !bomsRes.data.length || !routingsRes.data.length;
  } catch (error) { $('#mo-status').textContent = cloudError(error); }
}

$('#mo-item').addEventListener('change', () => loadMoPickers($('#mo-item').value));

const MAIN_WAREHOUSE = 'MAIN';

// Opening an MO is three separate inserts (MO row, stock issue, operations)
// run client-side in sequence, not one database transaction — there is no
// service layer yet (see docs/DATA-LAYER.md). If a later step fails here,
// earlier ones already committed; the status line says which step failed so
// it can be fixed by hand meanwhile.
$('#mo-form').addEventListener('submit', async event => {
  event.preventDefault();
  const itemId = $('#mo-item').value, bomId = $('#mo-bom').value, routingId = $('#mo-routing').value;
  const qty = Number($('#mo-qty').value);
  if (!itemId || !bomId || !routingId || !qty) return;
  const button = $('#mo-submit');
  button.disabled = true; $('#mo-status').textContent = 'กำลังเปิดใบสั่งผลิต…';
  try {
    const {data: docNo, error: docError} = await client.rpc('mst_next_doc_no', {p_doc_type: 'MO'});
    if (docError) throw docError;

    const {data: mo, error: moError} = await client.from('prod_manufacturing_orders').insert({
      doc_no: docNo, item_id: itemId, qty, bom_id: bomId, routing_id: routingId,
      due_date: $('#mo-due').value || null, status: 'RELEASED'
    }).select('id').single();
    if (moError) throw moError;

    $('#mo-status').textContent = `${docNo}: กำลังตัดสต็อกวัตถุดิบตาม BOM…`;
    const {data: bomLinesForMo, error: bomLinesError} = await client.from('prod_bom_lines')
      .select('component_item_id,qty_per_unit,scrap_pct').eq('bom_id', bomId);
    if (bomLinesError) throw bomLinesError;
    if (bomLinesForMo.length) {
      const issues = bomLinesForMo.map(line => ({
        item_id: line.component_item_id, warehouse_code: MAIN_WAREHOUSE, txn_type: 'MO_ISSUE',
        ref_type: 'prod_manufacturing_orders', ref_id: mo.id,
        qty: -(qty * Number(line.qty_per_unit) * (1 + Number(line.scrap_pct)))
      }));
      const {error: issueError} = await client.from('inv_stock_ledger').insert(issues);
      if (issueError) throw issueError;
    }

    $('#mo-status').textContent = `${docNo}: กำลังสร้างขั้นตอนผลิตจาก Routing…`;
    const {data: steps, error: stepsError} = await client.from('prod_routing_steps')
      .select('seq,dept_code').eq('routing_id', routingId).order('seq');
    if (stepsError) throw stepsError;
    if (steps.length) {
      const ops = steps.map((step, index) => ({
        mo_id: mo.id, seq: step.seq, dept_code: step.dept_code, status: index === 0 ? 'READY' : 'PENDING'
      }));
      const {error: opsError} = await client.from('prod_mo_operations').insert(ops);
      if (opsError) throw opsError;
    }

    event.target.reset();
    $('#mo-status').textContent = `เปิดใบสั่งผลิต ${docNo} แล้ว — ตัดสต็อกและสร้างขั้นตอนผลิตครบ`;
    toast(`เปิดใบสั่งผลิต ${docNo} แล้ว`);
    await loadMoList();
    if ($('#shopfloor-mo')) await loadShopfloorMoList();
    await loadStockBalances();
  } catch (error) { $('#mo-status').textContent = stockError(error); }
  finally { button.disabled = false; }
});

// ---- Shopfloor ----------------------------------------------------------------
let shopfloorMos = [], currentShopfloorMo = null, shopfloorOps = [];

function opStatusLabel(status) {
  return {PENDING: 'รอคิว', READY: 'พร้อมเริ่ม', RUNNING: 'กำลังทำ', DONE: 'เสร็จแล้ว'}[status] ?? status;
}

function renderShopfloorOps() {
  const wrap = $('#shopfloor-ops-wrap');
  if (!currentShopfloorMo) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'เลือกใบสั่งผลิตก่อน'}));
    return;
  }
  if (!shopfloorOps.length) {
    wrap.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'ใบสั่งผลิตนี้ยังไม่มีขั้นตอน (Routing ไม่มี step)'}));
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['ลำดับ', 'แผนก', 'สถานะ', 'จำนวนดี', 'จำนวนเสีย', '']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const op of shopfloorOps) {
    const tr = body.insertRow();
    tr.insertCell().textContent = op.seq;
    tr.insertCell().textContent = deptLabel({code: op.dept_code, name: depts.find(d => d.code === op.dept_code)?.name});
    tr.insertCell().textContent = opStatusLabel(op.status);
    const act = tr.insertCell();
    if (op.status === 'RUNNING') {
      const good = document.createElement('input');
      good.type = 'number'; good.min = '0'; good.step = 'any'; good.value = '0'; good.dataset.good = op.id;
      const reject = document.createElement('input');
      reject.type = 'number'; reject.min = '0'; reject.step = 'any'; reject.value = '0'; reject.dataset.reject = op.id;
      tr.insertCell().append(good);
      tr.insertCell().append(reject);
      const finish = document.createElement('button');
      finish.type = 'button'; finish.textContent = 'บันทึกจบขั้นตอน'; finish.dataset.finish = op.id;
      act.append(finish);
    } else {
      tr.insertCell().textContent = op.status === 'DONE' ? op.qty_good : '-';
      tr.insertCell().textContent = op.status === 'DONE' ? op.qty_reject : '-';
      if (op.status === 'READY') {
        const start = document.createElement('button');
        start.type = 'button'; start.textContent = 'เริ่มงาน'; start.dataset.start = op.id;
        act.append(start);
      }
    }
  }
  wrap.replaceChildren(table);
}

async function loadShopfloorOps(moId) {
  try {
    const {data, error} = await client.from('prod_mo_operations')
      .select('id,seq,dept_code,status,qty_good,qty_reject').eq('mo_id', moId).order('seq');
    if (error) throw error;
    shopfloorOps = data;
  } catch (error) { toast(cloudError(error)); shopfloorOps = []; }
  renderShopfloorOps();
}

async function loadShopfloorMoList() {
  try {
    const {data, error} = await client.from('prod_manufacturing_orders')
      .select('id,doc_no,item_id,qty,status').in('status', ['RELEASED', 'IN_PROGRESS']).order('created_at', {ascending: false});
    if (error) throw error;
    shopfloorMos = data;
    options($('#shopfloor-mo'), shopfloorMos, m => m.id, m => `${m.doc_no} (${moStatusLabel(m.status)})`, '— เลือกใบสั่งผลิต —');
    currentShopfloorMo = null; shopfloorOps = [];
    renderShopfloorOps();
  } catch (error) { toast(cloudError(error)); }
}

$('#shopfloor-mo').addEventListener('change', async () => {
  const id = $('#shopfloor-mo').value;
  currentShopfloorMo = shopfloorMos.find(m => m.id === id) ?? null;
  if (!currentShopfloorMo) { shopfloorOps = []; renderShopfloorOps(); return; }
  await loadShopfloorOps(id);
});

$('#shopfloor-ops-wrap').addEventListener('click', async event => {
  const startButton = event.target.closest('button[data-start]');
  const finishButton = event.target.closest('button[data-finish]');
  if (startButton) {
    startButton.disabled = true;
    try {
      const {error} = await client.from('prod_mo_operations')
        .update({status: 'RUNNING', started_at: new Date().toISOString()}).eq('id', startButton.dataset.start);
      if (error) throw error;
      await loadShopfloorOps(currentShopfloorMo.id);
    } catch (error) { toast(cloudError(error)); startButton.disabled = false; }
    return;
  }
  if (finishButton) {
    finishButton.disabled = true;
    const opId = finishButton.dataset.finish;
    const goodInput = $(`input[data-good="${opId}"]`), rejectInput = $(`input[data-reject="${opId}"]`);
    const qtyGood = Number(goodInput?.value) || 0, qtyReject = Number(rejectInput?.value) || 0;
    try {
      const {error: updateError} = await client.from('prod_mo_operations')
        .update({qty_good: qtyGood, qty_reject: qtyReject, status: 'DONE', finished_at: new Date().toISOString()})
        .eq('id', opId);
      if (updateError) throw updateError;

      const finishedOp = shopfloorOps.find(op => op.id === opId);
      // Routing steps commonly number 10, 20, 30... (see app.js's seed data), not
      // strictly +1, so find the next step by smallest greater seq, not seq+1.
      const nextOp = shopfloorOps.filter(op => op.seq > finishedOp.seq).sort((a, b) => a.seq - b.seq)[0];
      if (nextOp) {
        const {error: nextError} = await client.from('prod_mo_operations')
          .update({status: 'READY'}).eq('id', nextOp.id);
        if (nextError) throw nextError;
      } else {
        // Last step of the routing: receive the finished good into stock and close the MO.
        const item = items.find(i => i.id === currentShopfloorMo.item_id);
        const {error: receiptError} = await client.from('inv_stock_ledger').insert({
          item_id: currentShopfloorMo.item_id, warehouse_code: MAIN_WAREHOUSE, txn_type: 'MO_RECEIPT',
          ref_type: 'prod_manufacturing_orders', ref_id: currentShopfloorMo.id,
          qty: qtyGood, unit_cost: item?.standard_cost ?? 0
        });
        if (receiptError) throw receiptError;
        const {error: closeError} = await client.from('prod_manufacturing_orders')
          .update({status: 'DONE'}).eq('id', currentShopfloorMo.id);
        if (closeError) throw closeError;
        toast(`ปิดใบสั่งผลิต ${currentShopfloorMo.doc_no} แล้ว รับสินค้าสำเร็จรูปเข้าคลัง ${qtyGood} หน่วย`);
      }
      await loadShopfloorOps(currentShopfloorMo.id);
      await loadMoList();
      await loadStockBalances();
    } catch (error) { toast(stockError(error)); finishButton.disabled = false; }
  }
});

// ---- boot -------------------------------------------------------------------
async function boot() {
  client = createAppClient();
  $('#logout-restricted')?.addEventListener('click', () => client.auth.signOut());
  watchLoginMarks(client);
  client.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    if (await renderAuth()) loadMaster();
  });
  await enforceSessionTtl(client);
  const {data} = await client.auth.getUser();
  user = data?.user ?? null;
  if (await renderAuth()) await loadMaster();
}
boot();
