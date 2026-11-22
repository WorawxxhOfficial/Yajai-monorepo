# Yajai-monorepo

ยาใจ (YaJai) — เครื่องจ่ายยาอัตโนมัติที่ทำงานคู่กับแอปมือถือและ LINE ครอบครัว
โครงงานนักเรียน ม.4 · งานศิลปหัตถกรรมนักเรียน

## โครงสร้าง

```
apps/
  web-prototype/   เว็บโชว์ต้นแบบ (React + TypeScript + Vite + three.js)
                   หน้าแรก: Exploded View ของตัวเครื่อง แยกชิ้นส่วน + จำลองการจ่ายยา
packages/          (ยังว่าง) ที่สำหรับโค้ดที่ใช้ร่วมกัน เช่น contract ของ Firebase, กติกาการแจ้งเตือน
```

แผนถัดไป: `apps/mobile` (Expo), `services/server` (ตัวจับเวลา + LINE webhook บนเซิร์ฟเวอร์ Linux), `firmware/` (ESP32)

## เริ่มใช้งาน

ต้องมี Node 20 ขึ้นไป และ pnpm (`corepack enable` จะติดตั้ง pnpm ตามเวอร์ชันที่กำหนดไว้ใน `package.json`)

```bash
pnpm install
pnpm dev          # เปิดเว็บต้นแบบที่ http://localhost:5173
pnpm build        # typecheck + build ทุกแอป
pnpm preview      # เปิดไฟล์ที่ build แล้ว
```

## Web prototype · Exploded View

- ตัวเครื่อง 3D สร้างจากขนาดในเอกสารเสนอโครงงาน v1.0 (หน่วยในฉาก: 1 = 10 mm)
- ข้อมูลชิ้นส่วนทั้ง 11 ชิ้นอยู่ที่ `apps/web-prototype/src/exploded/parts.ts` แก้คำอธิบายหรือสเปกได้ที่ไฟล์นี้ไฟล์เดียว
- โมเดลและแอนิเมชันอยู่ที่ `DeviceScene.ts` ส่วนวัสดุอยู่ที่ `materials.ts`
- ฟอนต์: Inter (ตัวอักษรละติน) + Anuphan (ตัวอักษรไทย) โหลดจากแพ็กเกจ ไม่ต้องต่อเน็ต
