// The layout guide: a plain picture with a gray figure exactly where Jack goes and exactly as tall
// as he should be. It is sent with each background prompt, so Jack's position and height are set
// by the code, not guessed by the model. Because the code draws the figure, it also knows where
// Jack's head is, so no head detection is needed.

const sharp = require('sharp');
const template = require('./template');

const GUIDE = 1024; // the guide is drawn at the image model's size; boxes are fractions, so size does not matter

// Jack's head as fractions of the page: { x, y, w, h }.
function headBox(page) {
  const S = template.SIZE;
  const j = page.jack || {};
  if (j.hidden) {
    // Only his head shows (for example through the oven window): centred in the middle third.
    const size = 0.11;
    return { x: 0.5 - size / 2, y: 0.42, w: size, h: size };
  }
  if (template.isLying(page)) {
    const r = template.jackRect(page);
    const length = 0.46; // as long as an upright Jack on a bottom-caption page is tall
    const head = length * 0.17;
    const bed = r.feetY / S;
    return { x: 0.5 - length / 2, y: bed - head * 1.05, w: head * 0.9, h: head };
  }
  const r = template.jackRect(page);
  const h = (r.h / S) * 0.17;
  return { x: 0.5 - (h * 0.85) / 2, y: r.y / S, w: h * 0.85, h };
}

// SVG shapes for the figure, in guide pixels.
function figure(page) {
  const G = GUIDE;
  const hb = headBox(page);
  const hx = (hb.x + hb.w / 2) * G, hy = (hb.y + hb.h / 2) * G, hr = (hb.w / 2) * G, hry = (hb.h / 2) * G;
  const head = `<ellipse cx="${hx}" cy="${hy}" rx="${hr}" ry="${hry}"/>`;
  const j = page.jack || {};
  if (j.hidden) {
    // Head only, inside a dark frame for the window.
    const pad = hr * 1.6;
    return `<rect x="${hx - pad}" y="${hy - pad}" width="${pad * 2}" height="${pad * 2}" fill="none" stroke="#444" stroke-width="10"/>${head}`;
  }
  if (template.isLying(page)) {
    const length = 0.46 * G, thick = hb.h * G * 0.8;
    const x0 = hb.x * G + hb.w * G, y0 = (hb.y + hb.h / 2) * G - thick / 2;
    return `${head}<rect x="${x0}" y="${y0}" width="${length - hb.w * G}" height="${thick}" rx="${thick / 3}"/>`;
  }
  const r = template.jackRect(page);
  const top = (r.y / template.SIZE) * G, H = (r.h / template.SIZE) * G;
  const headH = hb.h * G, torsoW = headH * 1.5, cx = 0.5 * G;
  const torsoTop = top + headH * 1.05, torsoH = H * 0.38, legTop = torsoTop + torsoH, legH = top + H - legTop;
  const legW = torsoW * 0.38, armW = torsoW * 0.22;
  return [
    head,
    `<rect x="${cx - torsoW / 2}" y="${torsoTop}" width="${torsoW}" height="${torsoH}" rx="${torsoW / 6}"/>`,
    `<rect x="${cx - torsoW / 2 - armW - 4}" y="${torsoTop + 4}" width="${armW}" height="${torsoH * 0.95}" rx="${armW / 2}"/>`,
    `<rect x="${cx + torsoW / 2 + 4}" y="${torsoTop + 4}" width="${armW}" height="${torsoH * 0.95}" rx="${armW / 2}"/>`,
    `<rect x="${cx - torsoW / 2 + 2}" y="${legTop}" width="${legW}" height="${legH}" rx="${legW / 3}"/>`,
    `<rect x="${cx + torsoW / 2 - legW - 2}" y="${legTop}" width="${legW}" height="${legH}" rx="${legW / 3}"/>`,
  ].join('');
}

// PNG of the guide for one page.
function guideImage(page) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${GUIDE}" height="${GUIDE}">
    <rect width="${GUIDE}" height="${GUIDE}" fill="white"/><g fill="#8a8a8a">${figure(page)}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { headBox, guideImage };
