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
2. Apply บนโปรเจกต์ Supabase ทดลอง (ไม่ใช่ของจริง) แล้วทดสอบ RLS ต่อ role
3. Seed `gl_chart_of_accounts` และ `gl_account_defaults` ตามผังบัญชีจริงของบริษัท
4. เขียน service layer (Node/API) ที่ post เอกสาร → stock ledger → GL ให้ atomic
   (transaction เดียว ไม่ใช่หลาย request แยกกัน)
5. ค่อยย้าย UI ปัจจุบัน (app.js, mrp.html) จาก localStorage มาเรียก service นี้
