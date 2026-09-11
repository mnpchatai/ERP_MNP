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
   `erp-core-schema-hardening.sql` (2 รอบ กว่าจะเจอสาเหตุที่แท้จริงบนโปรเจกต์นี้ —
   ดูหัวข้อ "Apply กับ ERP_MNP จริง" ด้านล่าง เพราะยังไม่ใช่สาเหตุที่ถูกต้องทั้งหมด)
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

ตอนที่เขียนหัวข้อนี้ครั้งแรกยังไม่ได้ apply กับโปรเจกต์ ERP_MNP จริง — ตอนนี้ apply แล้ว
ดูหัวข้อถัดไป

## Apply กับ ERP_MNP จริงแล้ว (2026-09-10, ตามคำขอของผู้ใช้)

Apply `erp-core-schema.sql` + `erp-core-schema-hardening.sql` เข้าโปรเจกต์ Supabase
จริง **ERP_MNP** (`esxcwfrnoizftulqnudh`) ที่ `mrp.html`/`rb.html` ใช้งานอยู่ ตรวจ
`list_tables` ก่อน apply แล้วว่าไม่ชนกับตารางเดิม (`mrp_bom_data` 31,302 แถว,
`mrp_customers` 176 แถว ฯลฯ ยังอยู่ครบ ไม่ถูกแตะต้อง) เพิ่มแค่ 37 ตารางใหม่ตาม prefix
ของเรา ไม่ได้รัน functional test ด้วยข้อมูลปลอมกับโปรเจกต์จริง (ต่างจากตอนทดสอบบน
scratch project) เพราะ logic ผ่านการทดสอบแล้วรอบก่อนหน้า

**พบว่าคำอธิบายสาเหตุใน `erp-core-schema-hardening.sql` เดิมไม่ครบ**: บนโปรเจกต์
ERP_MNP จริง หลัง apply `erp-core-schema-hardening.sql` (revoke จาก `PUBLIC`) แล้ว
`get_advisors` ยังฟ้องว่า `anon` เรียก `org_has_role`/`org_is_admin`/
`mst_next_doc_no`/`inv_apply_stock_ledger` ได้อยู่ — ตรวจ `pg_proc.proacl` ตรงๆ
พบว่าโปรเจกต์ Supabase มี `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
FUNCTIONS TO anon, authenticated, service_role` ตั้งไว้เป็นค่าเริ่มต้น (มาตรฐานของ
Supabase สำหรับ expose function ผ่าน PostgREST) — grant นี้ให้สิทธิ์ตรงกับ role
`anon`/`authenticated` โดยชื่อ ไม่ได้ผ่าน `PUBLIC` เลย ดังนั้น revoke จาก `PUBLIC`
อย่างเดียวจึงไม่พอ ต้อง `revoke ... from anon, authenticated` ตรงๆ ด้วย แก้แล้วทั้งใน
production (migration `erp_core_schema_hardening_2`) และแก้ไฟล์ในโค้ดให้ถูกต้อง
ยืนยันด้วยการอ่าน `pg_proc.proacl` ตรงๆ ก่อน-หลัง ไม่ใช่แค่เชื่อ `get_advisors`
อย่างเดียว (เพราะผลลัพธ์ของ `get_advisors` มี cache lag)

ผลตรวจสุดท้ายบน ERP_MNP จริง:
- `inv_apply_stock_ledger`: เหลือแค่ `postgres`/`service_role` — เรียกตรงไม่ได้แล้ว
- `org_has_role`/`org_is_admin`/`mst_next_doc_no`: เหลือ `authenticated` (ตั้งใจ)
- `is_mrp_admin` ที่ยังโดน `get_advisors` ฟ้องว่า `anon` เรียกได้ — เป็น function
  เดิมของ `mrp-data-setup.sql` ที่มีอยู่ก่อนเรา ไม่ใช่สิ่งที่เราเพิ่ม ไม่ได้แก้ให้
  (นอกขอบเขตงานนี้ ถ้าต้องการแก้ให้แจ้งแยกต่างหาก)
- `auth_leaked_password_protection` — ตั้งค่า Auth ระดับโปรเจกต์ ไม่เกี่ยว schema

**ยังไม่มี**: seed ผังบัญชี/`gl_account_defaults` จริง, service layer ที่ post
เอกสาร → ledger → GL, และยังไม่ได้ย้าย UI (`app.js`, `mrp.html`) มาเรียก schema นี้
ตารางใหม่ทั้งหมดว่างเปล่า (0 แถว) รอการเชื่อมต่อจาก service layer ตามลำดับที่แนะนำ
ด้านบน

## สถานะล่าสุด (2026-09-11) — อ่านหัวข้อนี้ก่อนถ้าเริ่มบทสนทนาใหม่

เขียนไว้ให้ session ใหม่ (คนละบทสนทนา) อ่านแล้วรับช่วงงานต่อได้ทันทีโดยไม่ต้องมี
ประวัติแชทเดิม โค้ด/schema ทั้งหมดอยู่ใน git `main` แล้ว (PR #4–#9 merge หมดแล้ว)

**ตั้งค่าบนโปรเจกต์ ERP_MNP จริง (`esxcwfrnoizftulqnudh`) แล้ว:**
- Admin user: อีเมล `thtwgot@gmail.com` มี role `admin` ใน `org_user_roles`
  (รหัสผ่านผู้ใช้เป็นคนตั้งเอง ไม่ได้บันทึกไว้ในไฟล์ใดๆ ในโค้ด — ต้องถามผู้ใช้เอง
  ถ้าต้องใช้ทดสอบ)
- `org_departments`: seed 13 แผนกจากข้อมูลจริงใน `mrp_departments` แล้ว
- `mst_uom`: PCS, SET, M, KG, GR, RL
- `inv_warehouses`: `MAIN` (คลังหลัก) — เป็นคลังเดียวที่มีตอนนี้

**โค้ดแอปที่สร้างเพิ่ม:** `production.html` + `production.js` — หน้าใหม่แยกจาก
`app.js` (demo เดิม, localStorage) เชื่อม schema จริงทั้งหมด ต้องล็อกอินก่อนถึงใช้ได้
(ผ่าน `connect.html`, มี RLS คุ้มครองทุกตาราง) ตอนนี้มีครบ:
1. Item Master (`mst_items`) — เพิ่ม/ดูสินค้า FG/RM/WIP/SERVICE
2. วาง BOM (`prod_boms`/`prod_bom_lines`) ต่อสินค้า FG
3. วาง Routing (`prod_routings`/`prod_routing_steps`)
4. เปิดใบสั่งผลิต (`prod_manufacturing_orders`) — ตอนเปิดจะ **ตัดวัตถุดิบเข้า
   `inv_stock_ledger` อัตโนมัติ** ตาม BOM และสร้างขั้นตอนผลิตจาก Routing ให้เอง
5. หน้างานผลิต (shopfloor) — เริ่มงาน/บันทึกดี-เสียต่อ step, step สุดท้ายเสร็จแล้ว
   รับสินค้าสำเร็จรูปเข้าคลังอัตโนมัติ + ปิด MO
6. การ์ดยอดคงเหลือคลัง (`inv_stock_balances`) — รีเฟรชอัตโนมัติหลังทุกจุดที่ตัด/รับสต็อก
7. กันสต็อกติดลบที่ระดับ DB แล้ว (`inv_apply_stock_ledger` raise exception ถ้า
   ยอดจะติดลบ) — ทดสอบยืนยันกับฐานข้อมูลจริงแล้วผ่าน (ดูหัวข้อด้านบน)

**ข้อจำกัดสำคัญที่ต้องรู้ก่อนทำต่อ:**
- Sandbox ที่ใช้พัฒนา (Claude Code web session) **บล็อกไม่ให้ headless browser
  เชื่อมต่อ `*.supabase.co`** ได้เลย ทำให้ยืนยัน flow ล็อกอิน+เขียนข้อมูลจริงผ่าน
  browser ในนี้ไม่ได้สักครั้ง (ยืนยันแล้วว่ากระทบ `mrp.html` เดิมด้วยเช่นกัน ไม่ใช่
  บั๊กเฉพาะโค้ดใหม่) สิ่งที่ยืนยันได้จริงมีแค่: (ก) หน้า render ไม่มี JS error ตอนยัง
  ไม่ล็อกอิน (ข) logic ระดับ SQL/trigger ถูกต้องผ่านการทดสอบตรงกับฐานข้อมูล
- **ผู้ใช้ (มนุษย์) ยังไม่เคยทดสอบ flow เต็มในเบราว์เซอร์จริงเลยสักครั้ง** ตั้งแต่
  สร้าง `production.html` ขึ้นมา (PR #6–#9) — นี่คือความเสี่ยงที่ต้องปิดก่อนสร้าง
  ฟีเจอร์ใหม่ทับต่อ ถ้าเริ่ม session ใหม่แล้วผู้ใช้ยังไม่ได้ทดสอบ ให้ชวนทดสอบก่อน
  อย่าเพิ่งต่อยอดฟีเจอร์ใหม่ทับของที่ยังไม่เคยพิสูจน์ว่าใช้งานได้จริง
- Multi-transaction ไม่ atomic: การเปิด MO (ตัดสต็อก + สร้าง operations) และตอน
  ปิด MO (รับเข้าคลัง) เป็นการ insert หลายครั้งแยกกันฝั่ง browser ไม่ใช่ transaction
  เดียว ถ้าขั้นกลางพัง ข้อมูลก่อนหน้าจะค้าง — ต้องแก้ตอนมี service layer จริง

**ลำดับที่แนะนำต่อจากนี้** (เรียงตามความสำคัญ):
1. ให้ผู้ใช้ทดสอบ flow เต็มในเบราว์เซอร์ของเขาเอง (ล็อกอิน → เพิ่ม item → BOM →
   Routing → เปิด MO → ทำงานหน้างานจนจบ → เช็คยอดคลัง) แล้วแก้บั๊กที่เจอ
2. Seed ผังบัญชีจริง (`gl_chart_of_accounts` + `gl_account_defaults`) — ต้องขอ
   ข้อมูลจริงจากผู้ใช้/ฝ่ายบัญชี ห้ามเดาเอง
3. โมดูลขาย/ซื้อ (`sal_*`/`pur_*`) ต่อจาก production
4. เขียน service layer จริงให้ multi-table write เป็น atomic transaction
