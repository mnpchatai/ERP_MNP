# ฐานข้อมูล MRP จากชีต DATA

หน้า `mrp.html` (MAIN) อ่านข้อมูลจากตาราง `mrp_bom_data` บนโปรเจกต์ Supabase
`ERP_MNP` (`esxcwfrnoizftulqnudh`) ซึ่งเป็นสำเนาของชีต **DATA คอลัมน์ A–U** ในไฟล์
`Material_M&P MRP 4-1_Ver_(Toy).xlsm`

## คอลัมน์ A–U — หัวข้อคงเดิมทุกช่อง

| Excel | หัวข้อในชีต DATA | คอลัมน์ในฐานข้อมูล |
|---|---|---|
| A | ITEM | `item` |
| B | น.น RB/g | `rb_weight_g` |
| C | CODE | `code` |
| D | รหัสแผนก | `dept_code` |
| E | สินค้า/สูตรยาง | `product_formula` |
| F | สีSE/ประเภทยาง | `se_color_rubber_type` |
| G | ความยาวSE/สีRB | `se_length_rb_color` |
| H | รู,ความหนา/ความยาวRB | `hole_thickness_rb_length` |
| I | วงนอกSE/รูในRB | `se_od_rb_id` |
| J | วงนอกRB | `rb_od` |
| K | NAME | `name` |
| L | **แผนกผู้ผลิต** | `maker_dept` |
| M | จำนวนที่ใช้ต่อชุด | `qty_per_set` |
| N | ความยาวตัด | `cut_length` |
| O | หน่วย | `cut_unit` |
| P | จำนวนชิ้นที่ได้ต่อเส้น RB | `pcs_per_rb` |
| Q | หน่วย | `pcs_unit` |
| R | จำนวนที่ได้ต่อ 1 GR | `qty_per_gr` |
| S | หน่วย | `gr_unit` |
| T | หน่วยนับ RB | `rb_count_unit` |
| U | น.น ต่อเส้น RB / ก.ก | `rb_weight_per_strand` |

หัวข้อที่แสดงบนหน้าจอมาจาก `COLUMNS` ใน `mrp-data.mjs` ที่เดียว และตรงกับ
`COMMENT` ของทุกคอลัมน์ในฐานข้อมูล

**แผนกอ้างอิงคอลัมน์ L (แผนกผู้ผลิต) ไม่ใช่คอลัมน์ D (รหัสแผนก)** ทั้งตัวกรองใน
ตารางแก้ไข ตัวกรองใน BOMSHEET และตารางสรุปแผนก ใช้ค่าจากคอลัมน์ L ทั้งหมด

ทุกคอลัมน์เก็บเป็น `text` เพราะชีตต้นทางปนตัวเลขกับเครื่องหมาย `-` อยู่ในคอลัมน์
เดียวกัน การแปลงชนิดจะทำให้ค่าที่ฝ่ายวางแผนเห็นอยู่ทุกวันนี้เปลี่ยนไปเงียบ ๆ

ไฟล์ต้นทางมีช่องว่างหน้า/หลังค่าอยู่จริง (เช่น `Nasco-MCQL-28 `, `SE `, ` F01-346`)
ฐานข้อมูลจึงเก็บค่าดิบไว้ตามเดิม แล้วเพิ่มคอลัมน์ `item_norm` `code_norm`
`maker_dept_norm` ที่ตัดช่องว่างแล้วไว้ใช้ค้นหาและกรองแทน

## การทำงานที่ยกมาจากชีต MAIN

| ปุ่ม/ช่องในไฟล์ Excel | มาโคร/สูตรเดิม | ที่เดียวกันในหน้า `mrp.html` |
|---|---|---|
| ช่องเลือก ITEM / Package / Set of Color | `';}o'!A1 / J1 / M1` | ช่อง ITEM, Package, Set of Color |
| CODE ที่จะบันทึก | `';}o'!P1 = B1 & K1 & N1` | ช่อง "CODE ที่จะบันทึก" (คำนวณให้อัตโนมัติ) |
| กรองข้อมูล | `Arrange_Type_Work` + `DATA!X3:AR3` | ปุ่ม **กรองข้อมูล** |
| แก้ไขชิ้นส่วนก่อนเพิ่มรายการ | ชีต `Edit DATA` | ตารางแก้ไข (พิมพ์ทับในช่องได้) |
| เพิ่มจำนวน | `add_Item` (ถาม InputBox จำนวนสั่ง) | ปุ่ม **เพิ่มจำนวน** |
| เพิ่มข้อมูล (หัวเอกสาร) | `Add_Data_Customer` | ปุ่ม **เพิ่มข้อมูล** |
| BOMSHEET | ชีต `BOMSHEET` | การ์ด BOMSHEET (พิมพ์/บันทึก CSV ได้) |

ต่างจากไฟล์ Excel อยู่จุดเดียว: ชีต `Edit DATA` ตัดคอลัมน์ B (น.น RB/g) ออกแล้วเลื่อน
คอลัมน์ที่เหลือขึ้นมา ส่วนหน้านี้แสดง A–U ครบทั้ง 21 คอลัมน์ตามหัวข้อของชีต DATA
ตามที่ต้องการให้ "หัวข้อคงเดิม"

`mrp_bom_data` เป็นตารางอ่านอย่างเดียวสำหรับหน้าเว็บ ส่วน BOMSHEET เก็บใน
localStorage ของเครื่องที่เปิด เหมือนที่ชีต BOMSHEET เก็บอยู่ในไฟล์ Excel

## นำเข้าข้อมูลจากไฟล์ Excel

1. ติดตั้งสคีมา (ทำครั้งเดียวต่อโปรเจกต์): รัน `supabase/mrp-data-setup.sql`
   ใน SQL Editor — ทำไปแล้วบนโปรเจกต์ `ERP_MNP`
2. สร้างไฟล์ CSV จากชีต DATA:

   ```bash
   pip install openpyxl
   python3 tools/extract-mrp-data.py "Material_M&P MRP 4-1_Ver_(Toy).xlsm" mrp-data.csv
   ```

   สคริปต์อ่านค่าที่เก็บจริงในเซลล์ ไม่ใช่ข้อความที่ Excel จัดรูปแบบให้ ทศนิยมจึงครบ
   ตามต้นฉบับ (เช่น `0.08361111111111111`)
3. สร้างบัญชีผู้ดูแลใน Supabase → Authentication → Users แล้วเพิ่มลงรายชื่อ:

   ```sql
   insert into public.mrp_admins(user_id, note) values ('<user id>', 'MRP admin');
   ```
4. เปิด `mrp-import.html` เข้าสู่ระบบ เลือกไฟล์ `mrp-data.csv` แล้วกดนำเข้า
   หน้าเว็บจะตรวจหัวข้อ 21 คอลัมน์ให้ตรงกับชีต DATA ก่อน แล้วส่งเข้า Supabase
   ครั้งละ 500 แถว และเทียบยอดรวมกับจำนวนแถวในไฟล์เมื่อเสร็จ

ทำซ้ำขั้นตอนที่ 2 และ 4 ได้ทุกครั้งที่ไฟล์ Excel เปลี่ยน โดยติ๊ก
"ลบข้อมูลเดิมทั้งหมดก่อนนำเข้า" ไว้

## สิทธิ์และความปลอดภัย

- คีย์ในหน้าเว็บเป็น publishable key อ่านได้อย่างเดียว เขียนไม่ได้เพราะไม่มี policy
  ให้ insert/update/delete
- การนำเข้าต้องเป็นบัญชีที่อยู่ในตาราง `mrp_admins` เท่านั้น
- ไฟล์ Excel และไฟล์ CSV มีข้อมูลจริงของบริษัท **ห้ามคอมมิตเข้า repository นี้**
  (`.gitignore` กัน `mrp-data.csv` และไฟล์ `.xlsm` ไว้แล้ว)
- ตาราง `mrp_bom_data` ตั้งค่าให้อ่านได้ด้วยคีย์ publishable ซึ่งอยู่ในซอร์สโค้ดสาธารณะ
  เท่ากับว่าใครก็ตามที่ได้คีย์นี้อ่าน BOM ได้ทั้งหมด ถ้าต้องการปิดให้เหลือเฉพาะผู้ที่
  เข้าสู่ระบบ ให้รัน:

  ```sql
  drop policy mrp_bom_data_read on public.mrp_bom_data;
  create policy mrp_bom_data_read on public.mrp_bom_data
    for select to authenticated using (true);
  ```

  แล้วหน้า `mrp.html` จะต้องเพิ่มการเข้าสู่ระบบก่อนใช้งาน
