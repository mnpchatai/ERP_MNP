// Item master + BOM against the real erp-core-schema.sql tables (mst_items,
// prod_boms, prod_bom_lines, org_departments, mst_uom) on the ERP_MNP
// Supabase project. Every table here requires an authenticated session with
// RLS-granted role — there is no anon-readable path, unlike mrp-data.mjs.
import {createAppClient, cloudError} from './supabase-client.mjs';

const $ = s => document.querySelector(s);
let client, user = null;
let items = [], uoms = [], depts = [];
let currentBomId = null, bomLines = [];
let currentRoutingId = null, routingSteps = [];

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

// ---- auth ---------------------------------------------------------------
function renderAuth() {
  $('#auth-status').textContent = user ? `เข้าสู่ระบบแล้ว: ${user.email}` : 'ยังไม่ได้เข้าสู่ระบบ';
  $('#gate').hidden = !!user;
  $('#workspace').hidden = !user;
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
  for (const title of ['รหัส', 'ชื่อ', 'ประเภท', 'หน่วย', 'ต้นทุน', 'ราคาขาย']) {
    const th = document.createElement('th'); th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const item of items) {
    const tr = body.insertRow();
    tr.insertCell().textContent = item.code;
    tr.insertCell().textContent = item.name;
    tr.insertCell().textContent = item.item_type;
    tr.insertCell().textContent = item.uom_code;
    tr.insertCell().textContent = Number(item.standard_cost).toLocaleString('th-TH');
    tr.insertCell().textContent = Number(item.sales_price).toLocaleString('th-TH');
  }
  wrap.replaceChildren(table);
}

function populateItemPickers() {
  options($('#item-uom'), uoms, u => u.code, u => `${u.code} — ${u.name}`);
  const fgItems = items.filter(i => i.item_type === 'FG');
  options($('#bom-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
  options($('#line-component'), items, i => i.id, itemLabel, '— เลือกวัตถุดิบ/ชิ้นส่วน —');
  options($('#line-dept'), depts, d => d.code, deptLabel, '— ไม่ระบุแผนก —');
  options($('#routing-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
  options($('#step-dept'), depts, d => d.code, deptLabel, '— เลือกแผนก —');
  options($('#mo-item'), fgItems, i => i.id, itemLabel, '— เลือกสินค้า —');
}

async function loadMaster() {
  try {
    const [itemsRes, uomsRes, deptsRes] = await Promise.all([
      client.from('mst_items').select('id,code,name,item_type,uom_code,standard_cost,sales_price').order('code'),
      client.from('mst_uom').select('code,name').order('code'),
      client.from('org_departments').select('code,name').eq('is_active', true).order('code')
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (uomsRes.error) throw uomsRes.error;
    if (deptsRes.error) throw deptsRes.error;
    items = itemsRes.data; uoms = uomsRes.data; depts = deptsRes.data;
    renderItems(); populateItemPickers();
    await loadMoList();
  } catch (error) { toast(cloudError(error)); }
}

$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true; $('#item-status').textContent = 'กำลังบันทึก…';
  try {
    const {error} = await client.from('mst_items').insert({
      code: $('#item-code').value.trim(),
      name: $('#item-name').value.trim(),
      item_type: $('#item-type').value,
      uom_code: $('#item-uom').value,
      standard_cost: Number($('#item-cost').value) || 0,
      sales_price: Number($('#item-price').value) || 0
    });
    if (error) throw error;
    event.target.reset();
    $('#item-status').textContent = 'เพิ่มสินค้าแล้ว';
    toast('เพิ่มสินค้าแล้ว');
    await loadMaster();
  } catch (error) { $('#item-status').textContent = cloudError(error); }
  finally { button.disabled = false; }
});

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

$('#mo-form').addEventListener('submit', async event => {
  event.preventDefault();
  const itemId = $('#mo-item').value, bomId = $('#mo-bom').value, routingId = $('#mo-routing').value;
  if (!itemId || !bomId || !routingId) return;
  const button = $('#mo-submit');
  button.disabled = true; $('#mo-status').textContent = 'กำลังเปิดใบสั่งผลิต…';
  try {
    const {data: docNo, error: docError} = await client.rpc('mst_next_doc_no', {p_doc_type: 'MO'});
    if (docError) throw docError;
    const {error} = await client.from('prod_manufacturing_orders').insert({
      doc_no: docNo,
      item_id: itemId,
      qty: Number($('#mo-qty').value),
      bom_id: bomId,
      routing_id: routingId,
      due_date: $('#mo-due').value || null
    });
    if (error) throw error;
    $('#mo-qty').value = ''; $('#mo-due').value = '';
    $('#mo-status').textContent = `เปิดใบสั่งผลิต ${docNo} แล้ว`;
    toast(`เปิดใบสั่งผลิต ${docNo} แล้ว`);
    await loadMoList();
  } catch (error) { $('#mo-status').textContent = cloudError(error); }
  finally { button.disabled = false; }
});

// ---- boot -------------------------------------------------------------------
async function boot() {
  client = createAppClient();
  client.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    renderAuth();
    if (user) loadMaster();
  });
  const {data} = await client.auth.getUser();
  user = data?.user ?? null;
  renderAuth();
  if (user) await loadMaster();
}
boot();
