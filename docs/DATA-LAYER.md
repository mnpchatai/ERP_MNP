# Data layer design (draft)

สคีมาอยู่ที่ `supabase/erp-core-schema.sql` — เป็น **draft ที่ยังไม่ apply** เหมือนกับ
`supabase/rb-draft.sql` ต้องรีวิวและทดสอบบนโปรเจกต์ทดลองก่อน ไม่ใช่รันตรงกับ
โปรเจกต์ ERP_MNP บน Supabase ที่ใช้งานจริงอยู่ทันที

## ทำไมแยกจาก mrp_* / rb_* ที่มีอยู่

`mrp_bom_data` และ `rb_trial_plans` เป็นตารางเฉพาะกิจสำหรับนำเข้าข้อมูลจากไฟล์ Excel
(MRP DATA sheet) และเก็บ snapshot การคำนวณน้ำหนักยาง — ไม่ใช่โมเดลธุรกิจทั่วไป
สคีมาใหม่นี้แยก namespace ด้วย prefix ต่อโมดูล เพื่อไม่ให้ปนกัน:

| Prefix | โมดูล |
|---|---|
| `org_` | สิทธิ์ผู้ใช้ / แผนก (RBAC) |
| `mst_` | Master data ที่ทุกโมดูลใช้ร่วมกัน (สินค้า, หน่วยนับ, คู่ค้า, เลขที่เอกสาร) |
| `gl_`  | บัญชีแยกประเภท (General Ledger) |
| `inv_` | คลังสินค้า/สต็อก (immutable ledger + balance) |
| `prod_`| BOM, Routing, ใบสั่งผลิต (ต่อยอดจาก boms/routing/productions ใน app.js) |
| `sal_` | ขาย: SO → Delivery → Invoice → Receipt |
| `pur_` | ซื้อ: PO → Goods Receipt → Vendor Bill → Payment |
| `aud_` | audit log |

## ความสัมพันธ์หลัก (ย่อ)

```
mst_items ──< prod_bom_lines >── mst_items (component)
mst_items ──< prod_routing_steps (via prod_routings)
prod_manufacturing_orders ── snapshot: bom_id, routing_id (คงที่แม้ BOM เวอร์ชันใหม่ออก)
prod_manufacturing_orders ──< prod_mo_operations (ต่อ routing step)
prod_manufacturing_orders ──> inv_stock_ledger (MO_ISSUE ตัดวัตถุดิบ, MO_RECEIPT รับสินค้าสำเร็จรูป)

mst_parties (is_customer) ──< sal_sales_orders ──< sal_sales_order_lines
sal_sales_orders ──< sal_deliveries ──< sal_delivery_lines ──> inv_stock_ledger (SO_ISSUE)
sal_sales_orders ──< sal_sales_invoices ──< sal_sales_invoice_lines
sal_sales_invoices ──< sal_receipt_allocations >── sal_receipts

mst_parties (is_vendor) ──< pur_purchase_orders ──< pur_purchase_order_lines
pur_purchase_orders ──< pur_goods_receipts ──< pur_goods_receipt_lines ──> inv_stock_ledger (PO_RECEIPT)
pur_purchase_orders ──< pur_vendor_bills ──< pur_vendor_bill_lines
pur_vendor_bills ──< pur_payment_allocations >── pur_payments

gl_journal_entries ──< gl_journal_lines >── gl_chart_of_accounts
gl_account_defaults: anchor คงที่ (AR_CONTROL, AP_CONTROL, INVENTORY, SALES_REVENUE,
  COGS, VAT_OUTPUT, VAT_INPUT, ...) ให้โค้ดแอปอ้างชื่อแทน hardcode uuid
```

## จุดออกแบบที่ตั้งใจ

- **`inv_stock_ledger` เป็น append-only** ทุกความเคลื่อนไหวสต็อกคือแถวใหม่
  แก้ไขด้วยการเพิ่มแถว `ADJUSTMENT` เท่านั้น ไม่ update/delete ของเดิม —
  เพื่อให้ตรวจสอบย้อนหลังได้ (audit-friendly เหมือนหลักการบัญชี)
- **`inv_stock_balances` เขียนได้ทางเดียวผ่าน trigger** (`inv_apply_stock_ledger`,
  security definer) ไม่มี policy insert/update/delete ให้ authenticated โดยตรง
  ป้องกันยอดคงเหลือเพี้ยนจากการเขียนตรงข้าม ledger
- **`prod_manufacturing_orders` snapshot bom_id/routing_id** ตาม README เดิม
  ("ใบสั่งผลิตที่เปิดไปแล้วยังใช้ snapshot เดิม") แม้ BOM จะออกเวอร์ชันใหม่ทีหลัง
- **GL ไม่ผูก trigger อัตโนมัติกับ Sales/Purchase** เจตนา: กติกาการ post บัญชี
  (invoice นี้ debit/credit บัญชีไหน) เป็นตรรกะธุรกิจที่ต้องรีวิวได้ในโค้ด service
  ไม่ใช่ triggers ที่มองไม่เห็น — ให้ `gl_account_defaults` เป็นจุดอ้างอิงไว้ก่อน
- **`gl_journal_lines` บังคับ debit = credit ต่อ entry** ด้วย deferred constraint
  trigger กันไม่ให้ลง GL เอียงงบ
- **RBAC แบบ role พื้นฐาน**: admin/sales/purchase/production/accounting/viewer
  ผ่าน `org_user_roles` + helper function `org_has_role()`/`org_is_admin()`
  (security definer) ตาม pattern เดียวกับ `is_mrp_admin()` ที่มีอยู่แล้วใน
  `mrp-data-setup.sql`

## สิ่งที่ยังไม่ทำในดราฟต์นี้ (ตั้งใจเว้นไว้)

- Fixed assets, HR/Payroll — ยังไม่อยู่ใน scope ที่ README ปัจจุบันพูดถึง
- Row-level scoping แบบ "sales เห็นเฉพาะลูกค้าตัวเอง" — ตอนนี้ทุก role ที่มีสิทธิ์
  เขียนโมดูลนั้นเห็นข้อมูลทั้งหมดในโมดูล ต้องคุยกติกาธุรกิจก่อนค่อยเพิ่ม policy
- Multi-currency/multi-company — คอลัมน์ `currency` มีไว้เป็น placeholder เฉยๆ
- ตัวโค้ด service ที่ post GL จริงจากเอกสารขาย/ซื้อ/ผลิต (เขียนต่อจากดราฟต์นี้)

## ลำดับที่แนะนำต่อจากนี้

1. รีวิว schema นี้ร่วมกับทีมบัญชี/operation ว่าตรงกับ workflow จริงไหม
2. ~~Apply บนโปรเจกต์ Supabase ทดลอง~~ ทำแล้ว ดูหัวข้อ "ทดสอบจริงแล้ว" ด้านล่าง
3. Seed `gl_chart_of_accounts` และ `gl_account_defaults` ตามผังบัญชีจริงของบริษัท
4. เขียน service layer (Node/API) ที่ post เอกสาร → stock ledger → GL ให้ atomic
   (transaction เดียว ไม่ใช่หลาย request แยกกัน)
5. ค่อยย้าย UI ปัจจุบัน (app.js, mrp.html) จาก localStorage มาเรียก service นี้

## ทดสอบจริงแล้ว (2026-09-10)

Apply `erp-core-schema.sql` แล้วบนโปรเจกต์ Supabase **"mnpchatai's Project"**
(`myqmqffoqbbbbdgacvhm`) — เลือกโปรเจกต์นี้เพราะองค์กรใช้โควตาโปรเจกต์ฟรีครบ 2/2
แล้ว (ERP_MNP + โปรเจกต์นี้) สร้างโปรเจกต์ที่ 3 ไม่ได้ โปรเจกต์นี้มีตาราง `rb_*`
ของแอปอื่นอยู่ก่อนแล้วแต่ไม่ชนกับ prefix ของเรา **ไม่ได้ apply กับโปรเจกต์
ERP_MNP จริง** (`esxcwfrnoizftulqnudh`) ที่ `mrp.html`/`rb.html` ใช้งานอยู่

ขั้นตอนที่ทำ:

1. Apply `erp-core-schema.sql` — สร้างครบ 37 ตาราง, function, trigger, RLS policy
2. รัน `get_advisors` (security) พบ 2 ปัญหาจากโค้ดเรา: (ก) `gl_check_balanced`
   ไม่ได้ lock `search_path`, (ข) function security definer 4 ตัวเรียกผ่าน
   `/rest/v1/rpc/...` ได้จาก `anon` เพราะ Postgres grant `EXECUTE` ให้ `PUBLIC`
   เป็นค่าเริ่มต้นตอนสร้างฟังก์ชัน — revoke จาก role ที่ระบุชื่อ (`anon`)
   อย่างเดียวไม่พอ ต้อง revoke จาก `PUBLIC` โดยตรง แก้แล้วใน
   `erp-core-schema-hardening.sql` (2 รอบ กว่าจะเจอสาเหตุที่แท้จริง)
3. ทดสอบ flow จริงด้วยข้อมูลชุดเดียวกับ seed ใน `app.js`: สร้าง item/BOM-03/
   routing/MO ของ FG-1001 → รับวัตถุดิบเข้าคลัง (PO_RECEIPT) → เบิกเข้าใบสั่งผลิต
   (MO_ISSUE) → รับสินค้าสำเร็จรูป (MO_RECEIPT) → เปิด SO → ลง GL แบบสมดุล →
   ทดสอบว่า GL ไม่สมดุลแล้วโดนปฏิเสธจริง — **ผ่านทั้ง 6 การทดสอบ**:
   - PO_RECEIPT สร้าง `qty_on_hand`/`avg_cost` ถูกต้อง (500 / 120)
   - MO_ISSUE หักยอดถูกต้อง คง avg cost เดิม (456.74)
   - MO_RECEIPT เพิ่มยอดสินค้าสำเร็จรูปถูกต้อง (10)
   - บันทึก Sales Order + line ได้
   - GL entry ที่ debit=credit ผ่าน (7,500 / 7,500)
   - GL entry ที่ไม่สมดุล (debit 100, ไม่มี credit) ถูก `gl_check_balanced`
     ปฏิเสธจริงเมื่อ `SET CONSTRAINTS ... IMMEDIATE`
4. รัน `get_advisors` ซ้ำหลังแก้ — เหลือ warning ที่ไม่เกี่ยวกับ schema ของเรา:
   `rb_touch_updated_at` (function ของแอป rb_* เดิมในโปรเจกต์นี้ ไม่ใช่ของเรา),
   `auth_leaked_password_protection` (ตั้งค่า Auth ระดับโปรเจกต์ ไม่เกี่ยว schema),
   `auth_allow_anonymous_sign_ins` ต่อทุกตาราง (เป็น warning มาตรฐานเมื่อมี
   policy ให้ role `authenticated` ร่วมกับฟีเจอร์ anonymous sign-in ของ
   Supabase Auth — เป็นการตัดสินใจระดับโปรเจกต์ ไม่ใช่จุดบกพร่องของ schema),
   และ `org_has_role`/`org_is_admin`/`mst_next_doc_no` ยังเรียกได้จาก
   `authenticated` ซึ่ง**ตั้งใจให้เป็นแบบนั้น** (ผู้ใช้ที่ล็อกอินแล้วต้องเรียก
   ฟังก์ชันเหล่านี้ได้จริงตามที่ policy อื่นๆ ต้องพึ่งพา)

ยังไม่ได้ apply กับโปรเจกต์ ERP_MNP จริง และยังไม่มี service layer ต่อจาก UI —
ทดสอบนี้ยืนยันแค่ว่า schema/RLS/trigger ทำงานถูกต้องตามที่ออกแบบไว้เท่านั้น
