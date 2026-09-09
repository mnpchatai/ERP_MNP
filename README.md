# MNP ERP — Production Flow Simulation

Functional prototype สำหรับยืนยัน workflow ก่อนสร้างระบบจริง:

- รับ/ยืนยันคำสั่งซื้อและเปิดใบสั่งผลิต
- Snapshot BOM, คำนวณ Scrap, ตรวจและจองวัตถุดิบ
- สร้าง Routing และกำหนดเวลาจากเป้าหมายต่อชั่วโมง
- หน้างานกดเริ่ม บันทึกจำนวนดี/เสีย และส่งมอบขั้นตอนถัดไป
- รับสินค้าสำเร็จรูปเข้าคลัง พร้อม Audit timeline
- หน้าจอ IoT-ready แสดงงานที่กำลังผลิต

## เปิดใช้งาน

```powershell
python -m http.server 8787
```

เปิด `http://localhost:8787/` ข้อมูลจำลองเก็บใน localStorage และคืนค่าเริ่มต้นได้จากปุ่มมุมขวาบน

> รุ่นนี้ใช้ยืนยัน flow/หน้าจอเท่านั้น ยังไม่ใช่ Production เนื่องจากยังไม่มี PostgreSQL, API, Login/RBAC, transaction และ backup
