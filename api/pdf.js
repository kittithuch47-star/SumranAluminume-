const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let browser;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const html = String(body.html || '');
    const styles = String(body.styles || '');
    const links = String(body.links || '');

    if (!html || html.length > 3_500_000) {
      return res.status(400).json({ error: 'ข้อมูลเอกสารไม่ถูกต้องหรือมีขนาดใหญ่เกินไป' });
    }

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    const documentHtml = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${links}
<style>
${styles}

/* Server PDF normalization: use the same A4 print geometry as physical print. */
@page { size: A4 portrait; margin: 10mm; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
body * { visibility: visible !important; }
#print-area {
  position: static !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  min-height: 277mm !important;
  margin: 0 !important;
  padding: 2mm !important;
  box-sizing: border-box !important;
  box-shadow: none !important;
  border: 0 !important;
  border-radius: 0 !important;
  overflow: visible !important;
}
</style>
</head>
<body>${html}</body>
</html>`;

    await page.setContent(documentHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.emulateMediaType('print');

    // Wait for Prompt/Sarabun (or any other web fonts) before PDF generation.
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });

    const safe = String(body.title || 'Sumran-Aluminum')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 120);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF endpoint error:', err);
    return res.status(500).json({ error: 'ระบบสร้าง PDF มีปัญหา กรุณาลองใหม่อีกครั้ง' });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
};

