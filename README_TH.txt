Sumran Aluminum PWA Starter

1. ใน GitHub repo เดิม ให้อัปโหลด index.html, manifest.webmanifest, sw.js และโฟลเดอร์ icons/ ไปยัง root โดยรักษาชื่อไฟล์และตำแหน่งตามนี้
2. ห้ามลบ api/pdf.js หรือ package.json ที่มีอยู่เดิม เพราะระบบดาวน์โหลด PDF ต้องใช้ไฟล์เหล่านั้น
3. รอ Vercel Deploy Ready และเปิด https://sumranaluminume.vercel.app/
4. iPhone: เปิดด้วย Safari > Share > Add to Home Screen. Android: Chrome > เมนู > Install app / Add to Home screen
5. ทดสอบ Google Login, พนักงาน, ข้อมูล Firebase, พิมพ์และดาวน์โหลด PDF หลัง Deploy

หมายเหตุ: service worker รุ่นนี้ไม่เก็บข้อมูลแบบ offline เพื่อลดความเสี่ยงข้อมูลเอกสารเก่าและสิทธิ์ล็อกอินผิดพลาด การใช้งานระบบต้องมีอินเทอร์เน็ต

โครงสร้างรองรับการนำเว็บเดิมไปใช้ใน Capacitor ภายหลัง แต่การทำแอป native ต้องตั้งค่า auth redirect, storage/download และ build แยกสำหรับ iOS/Android
