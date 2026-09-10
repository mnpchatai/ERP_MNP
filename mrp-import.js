// Admin-only loader for sheet DATA columns A-U. Reads the CSV in the browser and
// writes straight to Supabase, so no company data passes through this repository.
import {createAppClient, cloudError, authError, linkError, linkCallbackError} from './supabase-client.mjs';
import {COLUMNS, FIELDS} from './mrp-data.mjs';
import {parseCsv, checkHeader} from './mrp-csv.mjs';

const $ = s => document.querySelector(s);
const BATCH = 500;
let user = null, admin = false, rows = null, running = false;

// Choosing a file and checking its headers needs no network, so a failed SDK load
// must not take the whole page down with it.
let client = null, clientError = null;
// detectSessionInUrl: the magic link returns with the session in the fragment.
try { client = createAppClient({detectSessionInUrl: true}); }
catch (error) { clientError = error.message; }

const say = text => { $('#status').textContent = text; };
function toast(message) {
  $('#toast').textContent = message; $('#toast').className = 'show';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').className = ''; }, 2600);
}
function controls() {
  $('#login').hidden = !!user || !client;
  $('#logout').hidden = !user;
  $('#start').disabled = running || !client || !user || !admin || !rows?.length;
}
// The password field only appears if someone asks for it; email alone is the
// normal path, so nothing about it is required until it is visible.
let usePassword = false;
function passwordMode(on) {
  usePassword = on;
  $('#password-row').hidden = !on;
  $('#password').required = on;
  $('#send-link').textContent = on ? 'เข้าสู่ระบบ' : 'ส่งลิงก์เข้าสู่ระบบทางอีเมล';
  $('#use-password').textContent = on ? 'ใช้ลิงก์ทางอีเมลแทน' : 'ใช้รหัสผ่านแทน';
  if (on) $('#password').focus();
}
async function signedIn(next) {
  user = next || null; admin = false;
  if (!user) { $('#auth-status').textContent = 'ยังไม่ได้เข้าสู่ระบบ'; controls(); return; }
  const {data, error} = await client.from('mrp_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  admin = !error && !!data;
  // A failed check is not the same as "not an admin" -- say which one happened.
  $('#auth-status').textContent = error
    ? `เข้าสู่ระบบแล้ว: ${user.email} — แต่ตรวจสิทธิ์ผู้ดูแลไม่สำเร็จ: ${cloudError(error)}`
    : admin
      ? `เข้าสู่ระบบแล้ว: ${user.email} — อยู่ในรายชื่อผู้ดูแล นำเข้าข้อมูลได้`
      : `เข้าสู่ระบบแล้ว: ${user.email} — ยังไม่อยู่ในรายชื่อ mrp_admins จึงยังนำเข้าไม่ได้`;
  controls();
}

$('#use-password').onclick = () => passwordMode(!usePassword);

$('#login').onsubmit = async event => {
  event.preventDefault();
  if (!client) return;
  const email = $('#email').value.trim();
  if (!email) return;
  $('#send-link').disabled = true;
  try {
    if (usePassword) {
      const {data, error} = await client.auth.signInWithPassword({email, password: $('#password').value});
      if (error) throw error;
      await signedIn(data.user);
      return;
    }
    // shouldCreateUser stays false: this page is for accounts an admin already
    // made, and a typo should say "no such account" rather than make one.
    const {error} = await client.auth.signInWithOtp({
      email,
      options: {shouldCreateUser: false, emailRedirectTo: location.href.split('#')[0]}
    });
    if (error) throw error;
    $('#auth-status').textContent =
      `ส่งลิงก์ไปที่ ${email} แล้ว — เปิดอีเมลแล้วกดลิงก์ในแท็บนี้ได้เลย (ลิงก์ใช้ได้ครั้งเดียว)`;
  } catch (error) {
    $('#auth-status').textContent = usePassword ? authError(error) : linkError(error);
  } finally { $('#password').value = ''; $('#send-link').disabled = false; }
};
$('#logout').onclick = async () => {
  const {error} = await client.auth.signOut({scope: 'local'});
  if (error) { toast('ออกจากระบบไม่สำเร็จ'); return; }
  await signedIn(null);
};

$('#file').onchange = async () => {
  rows = null; $('#preview').replaceChildren(); say(''); controls();
  const file = $('#file').files[0];
  if (!file) return;
  try {
    const table = parseCsv(await file.text()).filter(r => r.some(cell => String(cell).trim() !== ''));
    if (table.length < 2) throw Error('ไฟล์ไม่มีข้อมูล');
    const problem = checkHeader(table[0], COLUMNS.map(c => c.header));
    if (problem) throw Error(problem);
    rows = table.slice(1);
    const note = document.createElement('p');
    note.textContent = `อ่านได้ ${rows.length.toLocaleString('th-TH')} แถว x ${table[0].length} คอลัมน์ • หัวข้อตรงกับชีต DATA`;
    const sample = document.createElement('div'); sample.className = 'scroll';
    const preview = document.createElement('table');
    const head = preview.createTHead().insertRow();
    for (const column of COLUMNS) {
      const th = document.createElement('th'); th.textContent = column.header; head.append(th);
    }
    const body = preview.createTBody();
    for (const row of rows.slice(0, 5)) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().textContent = value;
    }
    sample.append(preview);
    $('#preview').replaceChildren(note, sample);
  } catch (error) {
    rows = null;
    $('#preview').replaceChildren(Object.assign(document.createElement('p'),
      {className: 'empty', textContent: error.message}));
  }
  controls();
};

$('#start').onclick = async () => {
  if (running || !rows?.length || !admin) return;
  running = true; controls();
  $('#progress').hidden = false; $('#progress').value = 0;
  try {
    if ($('#replace').checked) {
      say('กำลังลบข้อมูลเดิม…');
      const {error} = await client.from('mrp_bom_data').delete().gt('row_no', 0);
      if (error) throw error;
    }
    let done = 0;
    for (let start = 0; start < rows.length; start += BATCH) {
      const payload = rows.slice(start, start + BATCH).map((row, offset) => {
        const record = {row_no: start + offset + 3};   // sheet DATA data starts at row 3
        FIELDS.forEach((field, index) => { record[field] = row[index] ?? ''; });
        return record;
      });
      const {error} = await client.from('mrp_bom_data').insert(payload);
      if (error) throw error;
      done += payload.length;
      $('#progress').value = done / rows.length;
      say(`นำเข้าแล้ว ${done.toLocaleString('th-TH')} / ${rows.length.toLocaleString('th-TH')} แถว`);
    }
    const {count, error} = await client.from('mrp_bom_data').select('id', {count: 'exact', head: true});
    if (error) throw error;
    say(count === rows.length
      ? `นำเข้าครบ ${count.toLocaleString('th-TH')} แถว — ยอดในฐานข้อมูลตรงกับไฟล์ เปิดหน้า MAIN ใช้งานได้เลย`
      : `นำเข้า ${done.toLocaleString('th-TH')} แถว แต่ฐานข้อมูลมี ${count?.toLocaleString('th-TH')} แถว กรุณาตรวจสอบก่อนใช้งาน`);
  } catch (error) {
    say(error?.message && !error.status ? error.message : cloudError(error));
  } finally { running = false; controls(); }
};

if (client) {
  // Read the fragment before the SDK consumes it, so a failed link can explain itself.
  const callbackProblem = linkCallbackError(location.hash);
  client.auth.onAuthStateChange((_event, session) => {
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search);
    signedIn(session?.user);
  });
  client.auth.getUser()
    .then(({data}) => signedIn(data?.user))
    .catch(() => signedIn(null))
    .finally(() => { if (callbackProblem && !user) $('#auth-status').textContent = callbackProblem; });
} else {
  $('#auth-status').textContent = clientError;
  controls();
}
