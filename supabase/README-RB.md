# RB: ขั้นแรกของฐานข้อมูล

ไฟล์ `rb-staging.sql` สร้างพื้นที่เก็บสำเนาข้อมูลต้นฉบับสำหรับตรวจสอบเท่านั้น
ยังไม่ใช่ฐานข้อมูล ERP พร้อมใช้งาน และไม่มีข้อมูลบริษัทอยู่ใน SQL

1. เปิดโปรเจกต์ Supabase ที่ต้องการ แล้วเลือก SQL Editor → New query
2. คัดลอกเนื้อหา `rb-staging.sql` ทั้งไฟล์ แล้วกด Run เพียงครั้งเดียว
3. ตรวจว่าขึ้น Success และมี schema `rb_staging` พร้อม 3 ตาราง
4. ห้ามเพิ่ม schema นี้ใน Exposed schemas และยังไม่ต้องนำเข้า Excel เอง

สคริปต์ไม่ลบ/แก้ตารางเดิม ใช้ transaction; ถ้า schema มีอยู่แล้วจะหยุด
ไม่เขียนทับ หากมี error ให้เก็บข้อความ error มาตรวจ ไม่ต้องลบ schema เพื่อรันซ้ำ
ยังไม่ได้รันทดสอบ SQL นี้กับ PostgreSQL/Supabase ในงานนี้ ต้องตรวจผลหลังรัน

ตาราง source_files เก็บชื่อไฟล์และ SHA-256 ของไฟล์เต็มเพื่อระบุเวอร์ชัน
source_cells เก็บที่อยู่เซลล์ ค่า สูตร และชนิดข้อมูลแยกกัน
review_issues เก็บปัญหาที่ต้องตรวจโดยไม่แก้เนื้อหาต้นฉบับ

สิทธิ์ของ anon/authenticated ถูกปิด และเปิด RLS แบบไม่มี client policy
จึงยังอ่านเขียนผ่าน App ไม่ได้โดยตั้งใจ ต้องพัฒนาตารางใช้งานจริงและสิทธิ์
รายแผนกแยกจากข้อมูลดิบหลังตรวจความสัมพันธ์ครบก่อน
สต็อก SE ยังไม่มีการนำเข้าหรือกำหนดเป็นศูนย์

Publishable key ไม่ใช่สิทธิ์ผู้ดูแลฐานข้อมูล ไม่ต้องส่ง database password,
secret key หรือ service_role key ในแชต การสร้าง schema ทำผ่าน SQL Editor
ด้วยบัญชีผู้ดูแลของคุณ

อ้างอิง: https://supabase.com/docs/guides/database/postgres/row-level-security
และ https://supabase.com/docs/guides/api/using-custom-schemas
