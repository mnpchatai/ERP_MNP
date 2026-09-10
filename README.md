# MNP ERP — Production Flow Simulation

## RB Pilot 0.1

Run `node server.js` then open `http://localhost:8787/rb.html`.
The MRP MAIN page is at `http://localhost:8787/mrp.html` and reads the real DATA sheet from Supabase; load it first with `mrp-import.html` (see `docs/MRP-DATA.md`).
The RB page uses fictional samples, editable conversion/weight standards, explicit trial scrap rules, and browser-local immutable calculation snapshots. It does not reserve stock or connect to Supabase yet. `supabase/rb-draft.sql` is an unapplied draft with owner-only policies, not a production schema. Connection and authenticated integration require a Supabase project.

Verification: `node --test rb-calc.test.mjs`. No real company Excel data is included in this public repository. VBA equivalence and production batch rounding rules remain to be validated.

Functional prototype สำหรับยืนยัน workflow ก่อนสร้างระบบจริง:

- รับ/ยืนยันคำสั่งซื้อและเปิดใบสั่งผลิต
- Snapshot BOM, คำนวณ Scrap, ตรวจและจองวัตถุดิบ
- วาง BOM ได้ทุกแผนกจากเมนู "วาง BOM ทุกแผนก" ฝั่งซ้าย โดยระบุแผนกที่ใช้วัตถุดิบแต่ละรายการ
  เพิ่ม/แก้ไข/ลบรายการแล้วขึ้นเวอร์ชัน BOM ใหม่ ส่วนใบสั่งผลิตที่เปิดไปแล้วยังใช้ snapshot เดิม
  แผนก RB มีลิงก์ไปหน้าคำนวณน้ำหนักยางจากข้อมูลจริงบน Supabase (rb.html) แยกอีกหน้าหนึ่ง
- สร้าง Routing และกำหนดเวลาจากเป้าหมายต่อชั่วโมง
- หน้างานกดเริ่ม บันทึกจำนวนดี/เสีย และส่งมอบขั้นตอนถัดไป
- รับสินค้าสำเร็จรูปเข้าคลัง พร้อม Audit timeline
- หน้าจอ IoT-ready แสดงงานที่กำลังผลิต
- ป้องกันเริ่มงานก่อนฝ่ายวางแผนปล่อยงานและบังคับลำดับ Routing
- ปิดงานเข้าคลังและบันทึกส่งมอบให้ลูกค้า
- UI โทนน้ำเงินกรมท่าถึงฟ้าอ่อนตามพาเลต MNP
- หน้า MAIN (`mrp.html`) คำนวณวัตถุดิบจากชีต DATA ของไฟล์ Material_M&P MRP 4.1
  ทำงานตามลำดับเดียวกับชีต MAIN ในไฟล์ Excel คือเลือก ITEM + Package + Set of Color
  แล้วกรองข้อมูล แก้ไขชิ้นส่วน และเพิ่มจำนวนเข้า BOMSHEET
  แสดงคอลัมน์ A–U หัวข้อเดิมทุกช่อง และอ้างอิงแผนกจากคอลัมน์ L แผนกผู้ผลิต
  รายละเอียดและวิธีนำเข้าข้อมูลอยู่ใน `docs/MRP-DATA.md`

## เปิดใช้งาน

ต้องมี Node.js จากนั้นรันโดยไม่ต้องติดตั้ง dependency:

```powershell
node server.js
```

เปิด `http://localhost:8787/` ข้อมูลจำลองเก็บใน localStorage และคืนค่าเริ่มต้นได้จากปุ่มมุมขวาบน

> รุ่นนี้ใช้ยืนยัน flow/หน้าจอเท่านั้น ยังไม่ใช่ Production เนื่องจากยังไม่มี PostgreSQL, API, Login/RBAC, transaction และ backup
