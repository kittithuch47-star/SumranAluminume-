SUMRAN ALUMINUM — DIRECT PDF V1

ไฟล์ที่ต้องขึ้น GitHub/Vercel พร้อมกัน:
1) index.html
2) api/pdf.js
3) package.json

สำคัญ:
- อย่าอัปโหลดเฉพาะ index.html เพราะปุ่ม PDF ต้องเรียก /api/pdf
- ปุ่มพิมพ์เครื่องพิมพ์ยังใช้ window.print() เหมือนเดิม
- ปุ่ม PDF จะส่งเฉพาะ HTML ของ #print-area ไปให้ Chromium บน Vercelสร้าง PDF
- ไม่ใช้ html2pdf/html2canvas
- หลัง Deploy ให้ทดสอบ PDF ทั้ง Mac และ iPhone/iPad
