import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
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

    if (!fragment) {
      return res.status(400).json({ error: 'ไม่พบเนื้อหาเอกสาร' });
    }

    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true
    });

    const page = await browser.newPage();

    const fullHtml =
      '<!doctype html><html lang="th"><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      links +
      '<style>' + styles +
      '\n@page { size: A4 portrait; margin: 10mm; }' +
      '\nhtml,body{margin:0!important;padding:0!important;background:#fff!important;' +
      '-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
      '</style></head><body>' +
      fragment +
      '</body></html>';

    await page.setContent(fullHtml, {
      waitUntil: 'networkidle0',
      timeout: 45000
    });

    await page.emulateMediaType('print');

    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });

    const safe = String(body.title || 'Sumran-Aluminum')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 100);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + encodeURIComponent(safe) + '.pdf"'
    );

    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF_ERROR', err);
    return res.status(500).json({
      error: 'PDF server: ' + (err && err.message ? err.message : String(err))
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {
      }
    }
  }
}
