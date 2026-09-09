# การเชื่อม App กับ Supabase

ติดตั้ง dependencies ด้วย `npm ci --ignore-scripts` และเริ่มด้วย `npm start`
เปิด `/connect.html` จาก server นี้ (ไม่เปิด HTML ด้วย file://)
SDK 2.116.0 ถูก pin ใน package.json/lockfile และเสิร์ฟ UMD ให้ Browser
หากใช้ SDK ฝั่ง server ต้องใช้ Node 22 ขึ้นไป; static server ไม่ import SDK

หน้าเว็บใช้ public-config.js ที่มีเฉพาะ URL และ publishable key สำหรับ GitHub Pages
ห้ามใส่ secret/service_role key ในไฟล์นี้เด็ดขาด
SDK ถูกคัดลอกจาก lockfile ด้วย npm run build ไป vendor/ แล้ว commit สำหรับ Pages
ไม่ต้องมี Node server บน GitHub Pages; ใช้ path แบบ relative รองรับ /ERP_MNP/
endpoint /api/public-config เดิมยังมีใน local server แต่หน้าเว็บไม่เรียกใช้อีก

หน้า connect เชื่อม Auth และ login/logout บัญชี Supabase Auth ของโปรเจกต์
เก็บ session ใน memory เท่านั้น ไม่เก็บรหัสผ่านหรือ token ลง localStorage
ยังไม่มีการย้ายแผนเดิมไป cloud และยังไม่เชื่อมฟังก์ชันบันทึกแผนกับ database
ปุ่มตรวจตารางส่ง SELECT id LIMIT 1 ภายใต้ session ผู้ใช้ ไม่เขียนข้อมูล
ต้องตรวจ RLS และสิทธิ์ข้ามผู้ใช้ก่อนเปิดการบันทึกจริง

การติดตั้ง plugin กับการเชื่อม App เป็นคนละส่วน: .mcp.json เตรียม endpoint
ที่ scope ไปโปรเจกต์นี้ แต่ OAuth ต้องทำผ่านหน้าต่างเชื่อมบัญชีด้วยตัวคุณเอง
การมีไฟล์นี้ไม่ได้ยืนยันว่า Codex โหลดหรือ authenticate MCP แล้ว
ไม่ต้องส่งรหัสผ่านฐานข้อมูลหรือ secret key ในแชต
