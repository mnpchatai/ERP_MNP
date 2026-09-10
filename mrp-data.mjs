// Data access for the MRP database imported from the Excel workbook
// "Material_M&P MRP 4-1_Ver_(Toy).xlsm", sheet DATA columns A-U.
// The Excel headers are the contract here: COLUMNS is the single source of truth
// for what each database field is called on screen.
import {config} from './public-config.js';

export const COLUMNS = [
  {excel:'A', header:'ITEM',                            field:'item'},
  {excel:'B', header:'น.น RB/g',                        field:'rb_weight_g'},
  {excel:'C', header:'CODE',                            field:'code'},
  {excel:'D', header:'รหัสแผนก',                         field:'dept_code'},
  {excel:'E', header:'สินค้า/สูตรยาง',                    field:'product_formula'},
  {excel:'F', header:'สีSE/ประเภทยาง',                    field:'se_color_rubber_type'},
  {excel:'G', header:'ความยาวSE/สีRB',                   field:'se_length_rb_color'},
  {excel:'H', header:'รู,ความหนา/ความยาวRB',              field:'hole_thickness_rb_length'},
  {excel:'I', header:'วงนอกSE/รูในRB',                    field:'se_od_rb_id'},
  {excel:'J', header:'วงนอกRB',                          field:'rb_od'},
  {excel:'K', header:'NAME',                            field:'name'},
  {excel:'L', header:'แผนกผู้ผลิต',                       field:'maker_dept'},
  {excel:'M', header:'จำนวนที่ใช้ต่อชุด',                  field:'qty_per_set'},
  {excel:'N', header:'ความยาวตัด',                        field:'cut_length'},
  {excel:'O', header:'หน่วย',                            field:'cut_unit'},
  {excel:'P', header:'จำนวนชิ้นที่ได้ต่อเส้น RB',           field:'pcs_per_rb'},
  {excel:'Q', header:'หน่วย',                            field:'pcs_unit'},
  {excel:'R', header:'จำนวนที่ได้ต่อ 1 GR',               field:'qty_per_gr'},
  {excel:'S', header:'หน่วย',                            field:'gr_unit'},
  {excel:'T', header:'หน่วยนับ RB',                       field:'rb_count_unit'},
  {excel:'U', header:'น.น ต่อเส้น RB / ก.ก',              field:'rb_weight_per_strand'}
];

export const FIELDS = COLUMNS.map(c => c.field);
const SELECT = ['row_no', ...FIELDS].join(',');

// PostgREST over fetch. No SDK and no session: every mrp_* table is read-only
// to the publishable key, so there is nothing to authorise and nothing to write.
async function get(path, params) {
  const url = new URL(`${config.url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {apikey: config.key, Authorization: `Bearer ${config.key}`},
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Object.assign(Error(await response.text()), {status: response.status});
  return response.json();
}

export function dataError(error) {
  if (error?.name === 'TimeoutError') return 'ฐานข้อมูลตอบช้าเกินกำหนด กรุณาลองใหม่ ข้อมูลในหน้ายังอยู่ครบ';
  if (error?.status === 404) return 'ยังไม่พบตาราง mrp_bom_data บนโปรเจกต์นี้ กรุณาให้ผู้ดูแลนำเข้าข้อมูลจากชีต DATA ก่อน';
  if (error?.status === 401 || error?.status === 403) return 'คีย์เชื่อมต่อไม่มีสิทธิ์อ่านข้อมูล กรุณาตรวจการตั้งค่าโปรเจกต์';
  return 'อ่านฐานข้อมูลไม่สำเร็จ กรุณาตรวจเครือข่ายแล้วลองอีกครั้ง ข้อมูลในหน้ายังอยู่ครบ';
}

export const listItems       = () => get('mrp_items',             {select:'item,line_count', order:'item.asc'});
export const listDepartments = () => get('mrp_maker_departments', {select:'code,name,line_count', order:'sort_order.asc,code.asc'});
export const listCustomers   = () => get('mrp_customers',         {select:'name', order:'sort_order.asc'});
export const listPackages    = () => get('mrp_packages',          {select:'code', order:'sort_order.asc'});
export const listColorSets   = () => get('mrp_color_sets',        {select:'code', order:'sort_order.asc'});

// Excel "กรองข้อมูล" (Arrange_Type_Work): every DATA row whose column A equals the
// selected ITEM, in sheet order. DATA!X3 rewrites column A to the composed CODE,
// so the caller passes the ITEM+Package+Colour string it wants stamped on each row.
export async function filterByItem(item, composedCode) {
  if (typeof item !== 'string' || !item.trim()) throw Error('กรุณาเลือก ITEM สินค้าก่อนกรองข้อมูล');
  const rows = await get('mrp_bom_data', {
    select: SELECT, item_norm: `eq.${item.trim()}`, order: 'row_no.asc', limit: '2000'
  });
  return rows.map(row => ({...row, item: composedCode || row.item}));
}

export const countRows = async () => {
  const url = new URL(`${config.url}/rest/v1/mrp_bom_data`);
  url.searchParams.set('select', 'id');
  const response = await fetch(url, {
    headers: {apikey: config.key, Authorization: `Bearer ${config.key}`, Prefer: 'count=exact', Range: '0-0'},
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Object.assign(Error(await response.text()), {status: response.status});
  return Number((response.headers.get('content-range') || '').split('/')[1]) || 0;
};
