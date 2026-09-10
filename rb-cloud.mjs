import {calculate} from './rb-calc.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateSnapshot(record) {
  if (!record || !uuid.test(record.id) || record.ruleVersion !== 'trial-0.1') throw Error('รูปแบบแผนหรือเวอร์ชันสูตรไม่รองรับ');
  if (typeof record.reference !== 'string' || !record.reference.trim() || record.reference.length > 80) throw Error('อ้างอิงออเดอร์ไม่ถูกต้อง');
  if (!record.product || !['DEMO-RB-001','DEMO-RB-002'].includes(record.product.id) || typeof record.product.formula !== 'string') throw Error('รองรับเฉพาะสินค้าในรุ่นทดลอง');
  if (!Number.isFinite(Date.parse(record.created))) throw Error('วันที่แผนไม่ถูกต้อง');
  if (record.seStock !== undefined && record.seStock !== null) throw Error('สต็อก SE ต้องว่าง');
  const expected = calculate(record.inputs || {});
  for (const [key,value] of Object.entries(expected)) {
    if (typeof record.result?.[key] !== 'number' || !Number.isFinite(record.result[key]) || Math.abs(value-record.result[key])>1e-9*Math.max(1,Math.abs(value)))
      throw Error('ผลคำนวณในแผนไม่ตรงกับข้อมูลนำเข้า');
  }
  if (JSON.stringify(record).length > 20000) throw Error('แผนมีขนาดใหญ่เกินกำหนด');
  return record;
}
const sameJson = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys=Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&sameJson(a[k],b[k]));
};
export async function saveCloudPlan(client, record, userId) {
  validateSnapshot(record);
  if (!uuid.test(userId)) throw Error('กรุณาเข้าสู่ระบบก่อนบันทึก');
  const snapshot = structuredClone({...record,seStock:null});
  const row = {id:record.id,owner_id:userId,reference:record.reference,rule_version:record.ruleVersion,snapshot};
  const response = await client.from('rb_trial_plans').insert(row).select('id').single();
  if (!response.error) return response.data;
  if (response.error.code !== '23505') throw response.error;
  // A previous response may have been lost; compare, never overwrite a snapshot.
  const existing = await client.from('rb_trial_plans').select('id,snapshot').eq('id',record.id).eq('owner_id',userId).single();
  if (existing.error) throw existing.error;
  if (!sameJson(existing.data.snapshot,snapshot)) throw Error('เลขแผนนี้มีข้อมูลต่างกันอยู่แล้ว กรุณาคำนวณเป็นฉบับใหม่');
  return {id:existing.data.id};
}
export async function listCloudPlans(client,userId,page=0) {
  if (!uuid.test(userId) || !Number.isSafeInteger(page) || page<0) throw Error('คำขอโหลดประวัติไม่ถูกต้อง');
  const {data,error} = await client.from('rb_trial_plans').select('id,reference,created_at,snapshot')
    .eq('owner_id',userId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*20,page*20+19);
  if(error) throw error;
  return data;
}
