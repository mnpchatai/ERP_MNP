import {calculate} from './rb-calc.mjs';
import {mountCatalog} from './rb-catalog.mjs';
import {createAppClient,cloudError,authError} from './supabase-client.mjs';
import {saveCloudPlan,listCloudPlans,validateSnapshot} from './rb-cloud.mjs';
import {enforceSessionTtl,watchLoginMarks,isAdmin} from './auth-gate.mjs';
const $=s=>document.querySelector(s),key='mnp-rb-pilot-v1';
const fields=['quantity','stock','perFg','yield','weight','setup','joint','scrap','batch','increment'];
const products=[{id:'DEMO-RB-001',name:'ชิ้นส่วนยางตัวอย่าง A',formula:'DEMO-COMPOUND-A',perFg:2,yield:10,weight:100},{id:'DEMO-RB-002',name:'ชิ้นส่วนยางตัวอย่าง B',formula:'DEMO-COMPOUND-B',perFg:1,yield:5,weight:250}];
let current=null,history=[],client,user=null,saving=false,savedId=null,page=0,loadVersion=0;
const fmt=v=>v.toLocaleString('th-TH',{maximumFractionDigits:4});
const feedback=message=>$('#feedback').textContent=message;
try { const data=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(data))history=data; }
catch { feedback('อ่านประวัติในเครื่องไม่ได้ ข้อมูลเดิมยังไม่ถูกเขียนทับ'); }
for(const p of products){const o=document.createElement('option');o.value=p.id;o.textContent=p.id+' — '+p.name;$('#product').append(o);}
function controls(){
  $('#save').disabled=!current||!user||saving||savedId===current.id;
  $('#local-save').disabled=!current||saving;
  $('#print').disabled=!current;
}
function invalidate(){current=null;savedId=null;controls();$('#result').textContent='ข้อมูลเปลี่ยนแล้ว กรุณาคำนวณใหม่';}
$('#plan').addEventListener('input',invalidate);
$('#product').onchange=()=>{const p=products.find(p=>p.id==$('#product').value);for(const k of ['perFg','yield','weight'])$('#'+k).value=p[k];invalidate();};
function show(record){
  validateSnapshot(record);
  $('#result').replaceChildren();
  const title=document.createElement('p');title.textContent=record.reference+' / '+record.product.id+' / '+record.product.formula;$('#result').append(title);
  const table=document.createElement('table');
  for(const [key,label] of Object.entries({pieces:'ต้องการชิ้นส่วน (ชิ้น)',required:'RB ที่ต้องใช้ก่อนหักคลัง (เส้น)',produce:'RB ที่ต้องผลิต (เส้น)',net:'น้ำหนักสุทธิ (กก.)',setup:'เผื่อแกะหัว (กก.)',joint:'เผื่อข้อต่อ (กก.)',scrap:'เผื่อเสียทั่วไป (กก.)',total:'น้ำหนักรวม (กก.)',rounded:'น้ำหนักปัดตามขั้นต่ำ (กก.)',batches:'เทียบจำนวนโม่ — ไม่ได้ปัดโม่เต็ม',extra:'น้ำหนักเพิ่มจากการปัด (กก.)'})){
    const tr=table.insertRow();tr.insertCell().textContent=label;tr.insertCell().textContent=fmt(record.result[key]);
  }
  $('#result').append(table);
}
$('#plan').onsubmit=e=>{
  e.preventDefault();
  try {
    const inputs=Object.fromEntries(fields.map(k=>[k,Number($('#'+k).value)]));
    current={id:crypto.randomUUID(),reference:$('#reference').value.trim(),product:{...products.find(p=>p.id==$('#product').value)},inputs,result:calculate(inputs),created:new Date().toISOString(),ruleVersion:'trial-0.1',seStock:null};
    show(current);savedId=null;controls();feedback('คำนวณแล้ว — ยังไม่บันทึก ไม่จองหรือตัดสต็อก');
  }catch(err){invalidate();feedback(err.message);}
};
$('#save').onclick=async()=>{
  if(!current||!user||saving)return;
  const record=structuredClone(current),owner=user.id;
  saving=true;controls();feedback('กำลังบันทึกไป Supabase…');
  try {
    await saveCloudPlan(client,record,owner);
    if(user?.id!==owner)return;
    savedId=record.id;feedback('บันทึกบน Supabase แล้ว: '+record.reference);
    page=0;await loadCloud();
  }catch(error){if(user?.id===owner)feedback(error instanceof Error && !error.status ? error.message : cloudError(error));}
  finally{saving=false;controls();}
};
$('#local-save').onclick=()=>{
  if(!current)return;
  try {
    const next=[current,...history.filter(r=>r.id!==current.id)];localStorage.setItem(key,JSON.stringify(next));history=next;
    feedback('เก็บสำเนาใน Browser แล้ว — ไม่ใช่การบันทึกบน Supabase');renderLocal();
  }catch{feedback('บันทึกในเครื่องไม่สำเร็จ กรุณาตรวจพื้นที่ Browser');}
};
$('#print').onclick=()=>window.print();
function historyButton(record,cloud=false){
  const button=document.createElement('button');
  button.textContent=record.reference+' • '+(record.product?.id||'')+' • '+new Date(record.created).toLocaleString('th-TH');
  button.onclick=()=>{try{show(record);current=null;controls();$('#print').disabled=false;feedback('กำลังดูฉบับย้อนหลัง ('+(cloud?'Supabase':'Browser')+') — ไม่เปลี่ยนฟอร์มปัจจุบัน');}catch(error){feedback(error.message);}};
  return button;
}
function renderLocal(){
  $('#history').replaceChildren();
  for(const record of history){if(record&&typeof record==='object')$('#history').append(historyButton(record));}
  if(!history.length)$('#history').textContent='ยังไม่มีสำเนาใน Browser';
}
async function loadCloud(){
  const version=++loadVersion,owner=user?.id;
  $('#cloud-history').replaceChildren();$('#previous').disabled=true;$('#next').disabled=true;
  if(!owner){$('#cloud-status').textContent='เข้าสู่ระบบเพื่อดูแผนของคุณ';return;}
  $('#cloud-status').textContent='กำลังโหลดจาก Supabase…';
  try {
    const rows=await listCloudPlans(client,owner,page);
    if(version!==loadVersion||owner!==user?.id)return;
    let invalid=0;
    for(const row of rows){try{validateSnapshot(row.snapshot);$('#cloud-history').append(historyButton(row.snapshot,true));}catch{invalid++;}}
    $('#cloud-status').textContent='หน้า '+(page+1)+' • '+rows.length+' รายการ'+(invalid?' • '+invalid+' รายการรูปแบบไม่รองรับ (ไม่ได้แก้ไขข้อมูล)':'');
    $('#previous').disabled=page===0;$('#next').disabled=rows.length<20;
  }catch(error){if(version===loadVersion){$('#cloud-status').textContent=cloudError(error);$('#previous').disabled=page===0;}}
}
$('#refresh-cloud').onclick=()=>loadCloud();
$('#previous').onclick=()=>{if(page>0){page--;loadCloud();}};
$('#next').onclick=()=>{page++;loadCloud();};
async function setUser(next){
  const changed=user?.id!==next?.id;user=next||null;
  $('#login').hidden=!!user;$('#logout').hidden=!user;
  $('#auth-status').textContent=user?'เข้าสู่ระบบแล้ว: '+user.email:'ยังไม่ได้เข้าสู่ระบบ';
  const admin=user?await isAdmin(client):false;
  $('#workspace').hidden=!admin;$('#restricted').hidden=!user||admin;
  if(changed){invalidate();page=0;loadCloud();}controls();
}
$('#login').onsubmit=async event=>{
  event.preventDefault();$('#signin').disabled=true;
  try {
    if(!client)throw Error('SDK unavailable');
    const {data,error}=await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;setUser(data.user);
  }catch(error){$('#auth-status').textContent=authError(error);}
  finally{$('#password').value='';$('#signin').disabled=!client;}
};
$('#logout').onclick=async()=>{
  $('#logout').disabled=true;
  try {const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;setUser(null);feedback('ออกจากระบบแล้ว');}
  catch{$('#auth-status').textContent='ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง';}
  finally{$('#logout').disabled=false;}
};
renderLocal();controls();
try {
  client=createAppClient();
  mountCatalog(client);
  watchLoginMarks(client);
  client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>setUser(session?.user),0);});
  await enforceSessionTtl(client);
  const {data,error}=await client.auth.getUser();
  setUser(error?null:data.user);
  $('#signin').disabled=false;
}catch(error){$('#auth-status').textContent=error.message;}
