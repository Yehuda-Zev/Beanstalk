// The character bible: the single source for Jack's look, angles, lines and prompt text.
// Jack's drawing prompt (lib/jack.js) and the debug page both read from here, so they cannot drift apart.
// Side characters are defined in lib/story.js, and their layout lines in lib/template.js; both are shown here too.

const story = require('./story');
const template = require('./template');

const JACK = {
  clothes: story.JACK_CLOTHES,
  angles: {
    upright: 'Standing upright, full body.',
    lying: 'Lying flat and horizontal, the whole body lying down, wider than tall. Not standing.',
  },
  // Lines the drawing must keep to, on every page.
  rules: [
    'Style: modern 3D animated feature film, soft rim light, the same look as the background pictures. Never a photograph.',
    'Same face, hair, beard, glasses and clothes as the reference sheet.',
    'Expression and facing come from the page entry below.',
    'No smile unless the expression says so: otherwise the mouth is closed and neutral.',
    'Flat, pure green (#00FF00) backdrop filling the whole picture, with no shadow or floor on it. No other people, no text.',
  ],
};

const FLOOR_NAMES = {
  top: 'Floor line for pages whose caption is at the top',
  bottom: 'Floor line for pages whose caption is at the bottom',
  lying: 'Bed line for pages where Jack lies down',
};

// How big Jack is in the picture, so the drawn scale matches the scene.
function frameLine(page) {
  if (template.isLying(page)) return 'Frame: lying flat, about 70% of the picture width, feet and hands fully visible, centred, nothing cropped.';
  const pct = Math.round((template.jackRect(page).h / template.SIZE) * 100);
  return `Frame: standing, full body, about ${pct}% of the picture height from the top of the head to the soles of the boots, feet at the bottom of the frame, centred, nothing cropped.`;
}

// The exact prompt sent to the image model for Jack on this page.
function jackPrompt(page) {
  const angle = JACK.angles[template.isLying(page) ? 'lying' : 'upright'];
  return [
    `Draw the child from the reference, alone, full body. ${JACK.clothes}`,
    angle,
    frameLine(page),
    `Pose: ${page.jack.pose}.`,
    `Facing: ${page.jack.facing}. He must face this way, not the viewer, unless the facing says toward the viewer.`,
    `Expression: ${page.jack.expression}. The face must clearly show this expression.`,
    ...JACK.rules,
  ].join('\n');
}

function build(book) {
  const names = [...new Set(book.pages.flatMap((p) => p.characters))];
  return {
    title: book.title,
    jack: {
      clothes: JACK.clothes,
      angles: Object.entries(JACK.angles).map(([name, rule]) => ({ name, rule })),
      rules: JACK.rules,
      lines: Object.entries(template.JACK_PLACEMENT).map(([key, p]) => ({
        name: FLOOR_NAMES[key],
        down: Math.round(p.feetY * 100) + '% of the way down',
        height: Math.round(p.height * 100) + '% of the page for an upright Jack',
      })),
    },
    characters: names.map((key) => ({ key, label: story.CHARACTERS[key].label, desc: story.CHARACTERS[key].desc })),
    pages: book.pages.map((p) => ({
      n: p.n,
      caption: p.caption,
      textZone: p.textZone,
      characters: p.characters.map((k) => story.CHARACTERS[k].label),
      angle: template.isLying(p) ? 'lying' : 'upright',
      facing: (p.jack && p.jack.facing) || '',
      scale: (p.jack && p.jack.scale) || 1,
      pose: (p.jack && p.jack.pose) || '',
      expression: (p.jack && p.jack.expression) || '',
      jackPrompt: jackPrompt(p),
    })),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML for the debug page. Lists every Jack pose in the book, one per page, before anything is drawn.
function toHtml(b) {
  const rules = b.jack.rules.map((r) => `<li>${esc(r)}</li>`).join('');
  const lines = b.jack.lines.map((l) => `<li>${esc(l.name)}: ${esc(l.down)}, ${esc(l.height)}.</li>`).join('');
  const chars = b.characters.map((c) => `<li><b>${esc(c.label)}</b> (${esc(c.key)}): ${esc(c.desc)}</li>`).join('');
  const poses = b.pages
    .map((p) => `<div class="pose" style="border:1px solid #bbb;padding:8px;margin:8px 0">
      <b>Page ${p.n}</b> <small>(caption ${esc(p.textZone)}, Jack ${esc(p.angle)}, scale ${p.scale})</small>
      <div>Caption: ${esc(p.caption)}</div>
      <div>Pose: ${esc(p.pose)}</div>
      <div>Expression: ${esc(p.expression)}</div>
      <div>Facing: ${esc(p.facing)}</div>
      <div>Scene characters: ${esc(p.characters.join(', ') || 'none')}</div>
      <details><summary>Exact prompt sent for Jack</summary><pre style="white-space:pre-wrap">${esc(p.jackPrompt)}</pre></details>
    </div>`)
    .join('');
  return `<div class="row" id="bible">
  <h3>Character bible: Jack's poses</h3>
  <p>${b.pages.length} poses, one per page. Each one is what Jack will look like on that page. Nothing has been drawn yet.</p>
  <h4>Rules for every pose</h4>
  <p>Clothes: ${esc(b.jack.clothes)}</p>
  <ul>${rules}</ul>
  <h4>Where Jack's feet (or lying body) go</h4>
  <ul>${lines}</ul>
  <h4>Side characters</h4>
  <ul>${chars}</ul>
  <h4>Poses</h4>
  ${poses}
</div>`;
}

module.exports = { JACK, jackPrompt, build, toHtml };
