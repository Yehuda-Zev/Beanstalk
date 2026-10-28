const PDFDocument = require('pdfkit');

const SIZE = 768; // square pages, points

// Draws a dark gradient band so text stays readable on any art.
function band(doc, zone) {
  const h = SIZE * 0.34;
  const y = zone === 'top' ? 0 : SIZE - h;
  const stops = zone === 'top' ? [0.62, 0] : [0, 0.62];
  const g = doc.linearGradient(0, y, 0, y + h);
  g.stop(0, 'black', stops[0]).stop(1, 'black', stops[1]);
  doc.rect(0, y, SIZE, h).fill(g);
}

function caption(doc, text, zone) {
  const margin = 60;
  const h = SIZE * 0.34;
  const y = zone === 'top' ? 0 : SIZE - h;
  doc.font('Helvetica-Bold').fontSize(30).fillColor('white');
  const textH = doc.heightOfString(text, { width: SIZE - margin * 2, align: 'center' });
  doc.text(text, margin, y + (h - textH) / 2, {
    width: SIZE - margin * 2,
    align: 'center',
  });
}

function aboutPage(doc, name, details) {
  doc.addPage({ size: [SIZE, SIZE], margin: 0 });
  doc.rect(0, 0, SIZE, SIZE).fill('#fdf3dc');
  doc.fillColor('#3b2a1a').font('Helvetica-Bold').fontSize(44)
    .text('About Me', 60, 90, { width: SIZE - 120, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(34).fillColor('#2f6b2f')
    .text(name, 60, 180, { width: SIZE - 120, align: 'center' });
  doc.font('Helvetica').fontSize(22).fillColor('#3b2a1a');
  const lines = Object.entries(details).filter(([, v]) => v);
  let y = 270;
  for (const [k, v] of lines) {
    doc.font('Helvetica-Bold').text(k + ': ', 100, y, { continued: true, width: SIZE - 200 });
    doc.font('Helvetica').text(String(v));
    y = doc.y + 14;
  }
}

// pages: [{ image: Buffer, caption: string, textZone: 'top'|'bottom' }]
// about: { name, details: { Label: value } }
function buildPdf(pages, about) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [SIZE, SIZE], margin: 0, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const p of pages) {
      doc.addPage({ size: [SIZE, SIZE], margin: 0 });
      doc.image(p.image, 0, 0, { width: SIZE, height: SIZE });
      band(doc, p.textZone);
      caption(doc, p.caption, p.textZone);
    }
    aboutPage(doc, about.name, about.details);
    doc.end();
  });
}

module.exports = { buildPdf };
