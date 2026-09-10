import {config} from './public-config.js';
// One client per page. Session survives same-tab navigation, not browser restart.
export function createAppClient() {
  if (!globalThis.supabase?.createClient) throw Error('โหลด Supabase SDK ไม่สำเร็จ กรุณาโหลดหน้าใหม่');
  return globalThis.supabase.createClient(config.url, config.key, {
    auth: {persistSession:true, storage:sessionStorage, storageKey:'mnp-erp-auth-v1',
      autoRefreshToken:true, detectSessionInUrl:false}
  });
}
export function cloudError(error) {
  if (error?.code === 'PGRST205') return 'ยังไม่พบตารางที่ต้องใช้บนโปรเจกต์นี้ — ผู้ดูแลต้องติดตั้งสคีมาใน supabase/ ก่อน';
  if (error?.code === '42501') return 'บัญชีนี้ยังไม่มีสิทธิ์ดำเนินการ กรุณาให้ผู้ดูแลตรวจสิทธิ์และ RLS';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจเครือข่ายแล้วลองอีกครั้ง ข้อมูลในฟอร์มยังอยู่';
}
