// Puts the child onto a page. Every stored background already has a generic Jack in the right
// pose, size and place. Only his head is changed: a square around it is cut out, edited to the
// child's likeness, and blended back. Nothing outside that square can change.

const sharp = require('sharp');
const { toFile } = require('openai');
const story = require('./story');
const template = require('./template');

const EDIT_MODEL = process.env.FACE_MODEL || 'gpt-image-2.5-flare';
const FACE_QUALITY = process.env.FACE_QUALITY || 'medium';
const SHEET_MODEL = process.env.SHEET_MODEL || 'gpt-image-2';
const SHEET_QUALITY = process.env.JACK_SHEET_QUALITY || 'medium';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-4o-mini';
const MARGIN = 0.45; // extra room around the head, as a share of its size, for hair and beards
const EDIT_SIZE = 1024;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The child's likeness sheet (the "Jack sheet"), made from an uploaded photo.
async function makeJackSheet(client, photo) {
  const png = await sharp(photo).rotate().resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
  const res = await client.images.edit({
    model: SHEET_MODEL,
    image: [await toFile(png, 'photo.png', { type: 'image/png' })],
    prompt: story.jackSheetPrompt(),
    size: '1024x1024',
    quality: SHEET_QUALITY,
  });
  return Buffer.from(res.data[0].b64_json, 'base64');
}

// Asks a vision model where the generic Jack's head is. Returns { x, y, w, h } as fractions.
async function detectHead(client, background) {
  const url = 'data:image/jpeg;base64,' + background.toString('base64');
  const res = await client.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Find the head of Jack: the boy in a brown vest over a white shirt and green trousers. ' +
          'Include his hair, face and ears. Reply only with JSON {"x":..,"y":..,"w":..,"h":..} giving the box as fractions ' +
          'of the image width and height (0 to 1), x and y being the top-left corner.' },
        { type: 'image_url', image_url: { url } },
      ],
    }],
  });
  const box = JSON.parse(res.choices[0].message.content);
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof box[k] !== 'number' || !(box[k] >= 0 && box[k] <= 1)) throw new Error('Bad head box: ' + JSON.stringify(box));
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

// The square of the page that gets edited, in pixels, with room around the head.
function cropRect(box) {
  const S = template.SIZE;
  const cx = (box.x + box.w / 2) * S;
  const cy = (box.y + box.h / 2) * S;
  const side = Math.round(clamp(Math.max(box.w, box.h) * S * (1 + 2 * MARGIN), 96, S));
  const left = Math.round(clamp(cx - side / 2, 0, S - side));
  const top = Math.round(clamp(cy - side / 2, 0, S - side));
  return { left, top, width: side, height: side };
}

// A soft-edged oval mask, so the edited square blends into the page with no visible seam.
function featherMask(side) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">
    <defs><radialGradient id="g"><stop offset="0.72" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>
    <rect width="${side}" height="${side}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function facePrompt(page) {
  return [
    'Image 1 is a close-up from a storybook picture. Image 2 is a reference sheet of a child.',
    'Change only the boy in Image 1 so his head looks like the child in Image 2: same face shape, eyes, nose, mouth, ' +
      'hairstyle, hair colour, skin tone, age, glasses and facial hair.',
    `Keep his expression exactly: ${page.jack.expression}.`,
    'Keep exactly the same head position, angle, size, lighting, background and 3D animated film style as Image 1. ' +
      'Everything that is not his head stays exactly as it is. No text.',
  ].join('\n');
}

// Returns the page (JPEG) with the child's face on the generic Jack.
async function swapHead(client, background, jackSheet, box, page) {
  const rect = cropRect(box);
  const crop = await sharp(background).extract(rect).resize(EDIT_SIZE, EDIT_SIZE).png().toBuffer();
  const sheet = await sharp(jackSheet).png().toBuffer();
  const res = await client.images.edit({
    model: EDIT_MODEL,
    image: [
      await toFile(crop, 'page.png', { type: 'image/png' }),
      await toFile(sheet, 'jack.png', { type: 'image/png' }),
    ],
    prompt: facePrompt(page),
    size: `${EDIT_SIZE}x${EDIT_SIZE}`,
    quality: FACE_QUALITY,
  });
  return blendBack(background, Buffer.from(res.data[0].b64_json, 'base64'), rect);
}

// Puts an edited square back onto the page with soft edges.
async function blendBack(background, editedPng, rect) {
  const mask = await featherMask(rect.width);
  const patch = await sharp(editedPng)
    .resize(rect.width, rect.height)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(background)
    .resize(template.SIZE, template.SIZE)
    .composite([{ input: patch, left: rect.left, top: rect.top }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = { makeJackSheet, detectHead, swapHead, cropRect, blendBack };
