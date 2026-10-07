const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let browser = null;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const fragment = String(body.html || '');
    const styles = String(body.styles || '');
    const links = String(body.links || '');

    if (!fragment) return res.status(400).json({ error: 'ไม่พบเนื้อหาเอกสาร' });
    if (fragment.length > 3500000) return res.status(413).json({ error: 'เอกสารมีขนาดใหญ่เกินไป' });

    const executablePath = await chromium.executablePath();
    if (!executablePath) throw new Error('Chromium executablePath unavailable');

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    await page.setContent(`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${links}
<style>
${styles}
/* PDF server overrides only screen/mobile geometry; preserve V8 print rules. */
@page { size: A4 portrait; margin: 10mm; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  width: auto !important;
  min-width: 0 !important;
  overflow: visible !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
#print-area {
  position: static !important;
  transform: none !important;
  zoom: 1 !important;
  width: auto !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 !important;
  box-shadow: none !important;
  overflow: visible !important;
}
.a4-page {
  width: auto !important;
  max-width: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  box-shadow: none !important;
  box-sizing: border-box !important;
}
table { max-width: 100% !important; }
img, svg { max-width: 100%; }
</style>
</head>
<body>${fragment}</body>
</html>`, { waitUntil: 'networkidle0', timeout: 45000 });

    await page.emulateMediaType('print');
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });

    const safe = String(body.title || 'Sumran-Aluminum')
      .replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.pdf"`);
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF_ERROR', err);
