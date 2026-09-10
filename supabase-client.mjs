import {config} from './public-config.js';
// One client per page. Session survives same-tab navigation, not browser restart.
export function createAppClient() {
  if (!globalThis.supabase?.createClient) throw Error('โหลด Supabase SDK ไม่สำเร็จ กรุณาโหลดหน้าใหม่');
  return globalThis.supabase.createClient(config.url, config.key, {
    auth: {persistSession:true, storage:sessionStorage, storageKey:'mnp-erp-auth-v1',
      autoRefreshToken:true, detectSessionInUrl:false}
  });
}
// Sign-in failures have very different fixes -- a wrong password, a disabled
// provider and a blocked request all need different action -- so name the cause
// instead of collapsing them into one message.
export function authError(error) {
  const raw = String(error?.message ?? error ?? '').trim();
  const code = error?.code ?? error?.error_code ?? '';
  const status = error?.status;
  if (/invalid login credentials/i.test(raw) || code === 'invalid_credentials')
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง — ถ้าเพิ่งลบแล้วสร้างผู้ใช้ใหม่ ต้องใช้รหัสผ่านของบัญชีใหม่';
  if (/email logins are disabled|email_provider_disabled/i.test(raw) || code === 'email_provider_disabled')
    return 'โปรเจกต์นี้ปิดการเข้าสู่ระบบด้วยอีเมล — เปิดที่ Supabase → Authentication → Sign In / Providers → Email';
  if (/email not confirmed/i.test(raw) || code === 'email_not_confirmed')
    return 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล — ตอนสร้างผู้ใช้ให้ติ๊ก Auto Confirm User';
  if (/rate limit|too many requests/i.test(raw) || status === 429)
    return 'ลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (/failed to fetch|networkerror|load failed/i.test(raw))
    return 'ติดต่อ Supabase ไม่ได้ กรุณาตรวจอินเทอร์เน็ตหรือตัวบล็อกโฆษณา/ไฟร์วอลล์ที่อาจบล็อก supabase.co';
  return raw ? `เข้าสู่ระบบไม่สำเร็จ: ${raw}` : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
}
export function cloudError(error) {
  if (error?.code === 'PGRST205') return 'ยังไม่พบตารางที่ต้องใช้บนโปรเจกต์นี้ — ผู้ดูแลต้องติดตั้งสคีมาใน supabase/ ก่อน';
  if (error?.code === '42501') return 'บัญชีนี้ยังไม่มีสิทธิ์ดำเนินการ กรุณาให้ผู้ดูแลตรวจสิทธิ์และ RLS';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจเครือข่ายแล้วลองอีกครั้ง ข้อมูลในฟอร์มยังอยู่';
}
