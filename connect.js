import {config} from './public-config.js';
import {createAppClient,cloudError} from './supabase-client.mjs';
const $ = s => document.querySelector(s);
let client;
function signedIn(user) {
  $('#login').hidden = !!user;
  $('#logout').hidden = !user;
  $('#probe').hidden = !user;
  $('#auth-status').textContent = user ? `เข้าสู่ระบบแล้ว: ${user.email}` : 'ยังไม่ได้เข้าสู่ระบบ';
  $('#database').textContent = '';
}
try {
  const {url,key} = config;
  $('#project').textContent = `โปรเจกต์: ${new URL(url).hostname}`;
  client = createAppClient();
  const health = await fetch(`${url}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(10000)});
  if (!health.ok) throw Error(`Auth ตอบกลับ HTTP ${health.status}`);
  $('#connection').textContent = 'เชื่อมบริการ Auth สำเร็จ — ยังไม่ได้ยืนยันสิทธิ์อ่าน/เขียนฐานข้อมูล';
  $('#signin').disabled = false;
  signedIn(null);
  client.auth.onAuthStateChange((_event,session)=>signedIn(session?.user));
  const {data} = await client.auth.getUser();
  signedIn(data?.user);
} catch(error) { $('#connection').textContent = `เชื่อมต่อไม่สำเร็จ: ${error.message}`; }
$('#login').onsubmit = async event => {
  event.preventDefault(); $('#signin').disabled = true;
  try {
    const {data,error} = await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error) throw error;
    signedIn(data.user);
  } catch { $('#auth-status').textContent = 'เข้าสู่ระบบไม่สำเร็จ ตรวจบัญชี Supabase Auth รหัสผ่าน และการเชื่อมต่อ'; }
  finally { $('#password').value=''; $('#signin').disabled=false; }
};
$('#logout').onclick = async () => {
  const {error} = await client.auth.signOut({scope:'local'});
  if(error) { $('#auth-status').textContent='ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง'; return; }
  signedIn(null);
};
$('#probe').onclick = async () => {
  $('#probe').disabled=true;
  try {
    const {error} = await client.from('rb_trial_plans').select('id').limit(1);
    $('#database').textContent=error ? cloudError(error) : 'อ่านตารางสำเร็จ — เปิดหน้า RB เพื่อคำนวณและบันทึกแผน';
  } catch { $('#database').textContent='ตรวจฐานข้อมูลไม่สำเร็จ กรุณาตรวจเครือข่าย'; }
  finally { $('#probe').disabled=false; }
};
