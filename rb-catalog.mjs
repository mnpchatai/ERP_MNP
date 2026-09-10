import {cloudError} from './supabase-client.mjs';
export function mountCatalog(client) {
 const $=s=>document.querySelector(s);
 let generation=0;
 const status=message=>$('#catalog-status').textContent=message;
 async function search(event){
  event?.preventDefault();const request=++generation;
  $('#catalog-items').replaceChildren();$('#catalog-detail').replaceChildren();status('กำลังโหลด Item จริง…');
  try{
   const {data:auth,error:authError}=await client.auth.getUser();
   if(authError||!auth.user){status('เข้าสู่ระบบเพื่อดู Item ของบริษัท');return;}
   let query=client.from('rb_item_catalog').select('id,item_code,item_name,source_name,rb_count,bom_row_count')
    .eq('owner_id',auth.user.id).order('item_code').order('id').limit(51);
   const term=$('#catalog-search').value.trim();
   if(term)query=query.ilike('item_code',term.replace(/[\\%_]/g,'\\$&')+'%');
   const {data,error}=await query;
   if(request!==generation)return;
   if(error)throw error;
   status(data.length>50?'แสดง 50 รายการแรก กรุณาพิมพ์รหัสให้เจาะจงขึ้น':'พบ '+data.length+' รายการ');
   for(const row of data.slice(0,50)){
    const button=document.createElement('button');
    button.textContent=row.item_code+' — '+row.item_name+' | '+row.source_name;
    button.onclick=()=>detail(row.id);$('#catalog-items').append(button);
   }
  }catch(error){if(request===generation)status(cloudError(error));}
 }
 async function detail(id){
  const request=++generation;$('#catalog-detail').replaceChildren();status('กำลังโหลดแถว RB ต้นฉบับ…');
  try{
   const {data,error}=await client.from('rb_item_catalog').select('item_code,source_name,rb_count,bom_row_count,rb_rows,production_ready').eq('id',id).single();
   if(request!==generation)return;if(error)throw error;
   status('Item '+data.item_code+' • แสดง RB '+data.rb_count+' แถว จาก BOM '+data.bom_row_count+' แถวใน Excel');
   const note=document.createElement('p');note.textContent='ข้อมูลจริงจาก '+data.source_name+' / DATA — ค่า ณ วันที่บันทึกไฟล์ ไม่ได้คำนวณ Excel ใหม่ ยังไม่รับรองออกใบสั่งผลิต และจะไม่ใช้สูตร DEMO กับ Item นี้';
   $('#catalog-detail').append(note);
   const table=document.createElement('table');const header=table.createTHead().insertRow();
   const cols={row:'แถว Excel',C:'รหัสชิ้นส่วน',K:'รายละเอียด',M:'ใช้ต่อชุด',N:'ความยาวตัด',O:'หน่วย',P:'ชิ้นต่อ RB',Q:'หน่วย',R:'จำนวนต่อ GR',S:'หน่วย',T:'หน่วย RB',U:'ค่า U ต้นฉบับ'};
   if(data.source_name.startsWith('DATA BOM'))cols.U='น้ำหนักเฉลี่ย (กรัม)';else cols.U='น้ำหนักต่อเส้น RB (กก.)';
   for(const title of Object.values(cols)){const th=document.createElement('th');th.textContent=title;header.append(th);}
   const body=table.createTBody();
   for(const source of data.rb_rows){const tr=body.insertRow();for(const col of Object.keys(cols)){const td=tr.insertCell();td.textContent=col==='row'?String(source.row):(source.values[col]??'ว่าง');if(source.types?.[col]==='e')td.style.color='#b42318';}}
   $('#catalog-detail').append(table);
  }catch(error){if(request===generation)status(cloudError(error));}
 }
 $('#catalog-form').onsubmit=search;
 client.auth.onAuthStateChange(()=>{generation++;$('#catalog-items').replaceChildren();$('#catalog-detail').replaceChildren();setTimeout(()=>search(),0);});
 search();
}
