-- Extends mst_items with the fuller Item Master field set to match the
-- legacy "โครงสร้างสินค้า" form (screenshot supplied by the user): name in
-- Thai/English, a secondary code, a secondary UOM with conversion qty,
-- class/subtype/group, dimensions, weights, process time, validity dates,
-- and Used/Revision counters.
--
-- APPLIED to the real ERP_MNP project (esxcwfrnoizftulqnudh) on 2026-09-11 —
-- additive only, no existing column touched, table had 0 rows at the time so
-- nothing needed backfilling. Kept here so the file tree matches what is
-- actually live, same pattern as erp-core-schema-hardening.sql and
-- erp-core-schema-stock-guard.sql.
--
-- Two CHECK constraints encode the legacy form's warning box verbatim: no
-- backslash, no single quote, and no leading symbol in code/name/name_en.
-- "Used" and "Revision" are plain counters (default 0) with no trigger yet —
-- automatic tracking is left for later, same as gl_account_defaults posting
-- logic in erp-core-schema.sql.
--
-- item_group is free text, not an FK to org_departments: the department
-- codes actually seeded there are composite (e.g. BG-PT, PK-ST), not the
-- flat RB/GR/PT/BG/PK/ST/WH set the legacy "กรุ๊ป" field implies.

alter table public.mst_items
  add column if not exists name_en text,
  add column if not exists code_secondary text,
  add column if not exists barcode text,
  add column if not exists uom_secondary_code text references public.mst_uom(code),
  add column if not exists uom_secondary_qty numeric(18,4),
  add column if not exists item_class text,
  add column if not exists item_subtype text,
  add column if not exists item_group text,
  add column if not exists description text,
  add column if not exists shape text,
  add column if not exists dim_length numeric(18,4),
  add column if not exists dim_length_uom text default 'mm',
  add column if not exists dim_width numeric(18,4),
  add column if not exists dim_width_uom text default 'mm',
  add column if not exists dim_thickness numeric(18,4),
  add column if not exists dim_thickness_uom text default 'mm',
  add column if not exists dim_height numeric(18,4),
  add column if not exists dim_height_uom text default 'mm',
  add column if not exists volume numeric(18,6),
  add column if not exists volume_uom text default 'M3',
  add column if not exists process_time_min numeric(18,4),
  add column if not exists size_value numeric(18,4),
  add column if not exists size_uom text default 'mm',
  add column if not exists weight_min numeric(18,4),
  add column if not exists weight_per_piece numeric(18,4),
  add column if not exists weight_per_piece_uom text default 'Ct',
  add column if not exists weight_max numeric(18,4),
  add column if not exists scrap_qty numeric(18,4),
  add column if not exists valid_from date default current_date,
  add column if not exists valid_to date,
  add column if not exists used_count integer not null default 0,
  add column if not exists revision integer not null default 0;

comment on column public.mst_items.name is 'ชื่อไทย (ชื่อหลักที่แสดงในระบบ)';
comment on column public.mst_items.name_en is 'ชื่ออังกฤษ';
comment on column public.mst_items.code_secondary is '"เสริม" — รหัสเสริม/อ้างอิงจากระบบเดิม';
comment on column public.mst_items.uom_secondary_code is 'หน่วยย่อย: หน่วยนับที่สองสำหรับแปลงค่า (เช่น 1 หน่วยหลัก = N หน่วยย่อย)';
comment on column public.mst_items.uom_secondary_qty is 'จำนวนหน่วยย่อยต่อ 1 หน่วยหลัก';
comment on column public.mst_items.item_class is '"คลาส" — หมวดจำแนกระดับบนสุด เช่น Process';
comment on column public.mst_items.item_subtype is '"ไทป์" — วัตถุดิบ/สินค้า/ชิ้นส่วน';
comment on column public.mst_items.item_group is '"กรุ๊ป" — free text, มักเป็นรหัสแผนกในระบบเดิม แต่ไม่ผูก FK กับ org_departments เพราะชุดรหัสจริงเป็น composite ไม่ตรง 1:1';
comment on column public.mst_items.used_count is 'ตัวนับ "Used" — ยังไม่มี trigger อัปเดตอัตโนมัติ (ต้องทำภายหลัง)';
comment on column public.mst_items.revision is 'ตัวนับ "Revision" — ยังไม่มี trigger อัปเดตอัตโนมัติ (ต้องทำภายหลัง)';

alter table public.mst_items
  add constraint mst_items_code_no_bad_chars
    check (position('\' in code) = 0 and position('''' in code) = 0),
  add constraint mst_items_code_leading_char
    check (code ~ '^[A-Za-z0-9ก-๙]'),
  add constraint mst_items_name_no_bad_chars
    check (position('\' in name) = 0 and position('''' in name) = 0),
  add constraint mst_items_name_leading_char
    check (name ~ '^[A-Za-z0-9ก-๙]'),
  add constraint mst_items_name_en_no_bad_chars
    check (name_en is null or (position('\' in name_en) = 0 and position('''' in name_en) = 0)),
  add constraint mst_items_name_en_leading_char
    check (name_en is null or name_en ~ '^[A-Za-z0-9]');
