import {createAppClient} from './supabase-client.mjs';

const importId='b3ebb2a0-5728-427d-b047-ffe1c8aa8595';
const endpoint='https://ijwutauepgelxonbjvnn.supabase.co/functions/v1/import-bom-source';
const $=id=>document.getElementById(id); const file=$('file'), start=$('start'), status=$('status'), auth=$('auth'), progress=$('progress');
const client=createAppClient(); let session=null;
async function init(){ const result=await client.auth.getSession(); session=result.data.session; if(session){auth.textContent=`เข้าสู่ระบบแล้ว: ${session.user.email}`; start.disabled=false;} else auth.textContent='ยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบที่หน้า RB ก่อน'; }
function say(text){status.textContent=text;}
async function run(){
  if(!file.files[0]||!session) return; start.disabled=true; progress.hidden=false;
  try{
    say('กำลังอ่านไฟล์…'); const rows=JSON.parse(await file.files[0].text());
    if(!Array.isArray(rows)||!rows.length) throw Error('ไม่พบรายการข้อมูลในไฟล์');
    const batch=200; let done=0;
    for(let i=0;i<rows.length;i+=batch){
      const token=(await client.auth.getSession()).data.session?.access_token; if(!token) throw Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({import_id:importId,rows:rows.slice(i,i+batch)})});
      const result=await response.json(); if(!response.ok) throw Error(result.error||'ส่งข้อมูลไม่สำเร็จ');
      done+=Math.min(batch,rows.length-i); progress.value=done/rows.length; say(`นำเข้าแล้ว ${done.toLocaleString()} / ${rows.length.toLocaleString()} แถว`);
    }
    say(`ส่งข้อมูลครบ ${done.toLocaleString()} แถวแล้ว ผู้ดูแลกำลังตรวจยอดในฐานข้อมูล`);
  }catch(error){say(error.message||'นำเข้าไม่สำเร็จ'); start.disabled=false;}
}
file.addEventListener('change',()=>{start.disabled=!file.files.length||!session;}); start.addEventListener('click',run); init();
