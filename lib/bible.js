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
    'Same face, hair, beard, glasses and clothes as the reference sheet.',
    'Expression and facing come from the page entry below.',
    'Flat, pure green (#00FF00) backdrop filling the whole picture, with no shadow or floor on it. No other people, no text.',
  ],
};

const FLOOR_NAMES = {
  top: 'Floor line for pages whose caption is at the top',
  bottom: 'Floor line for pages whose caption is at the bottom',
  lying: 'Bed line for pages where Jack lies down',
};

// The exact prompt sent to the image model for Jack on this page.
function jackPrompt(page) {
  const angle = JACK.angles[template.isLying(page) ? 'lying' : 'upright'];
  return [
    `Draw the child from the reference, alone, full body. ${JACK.clothes}`,
    angle,
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
      jackPrompt: jackPrompt(p),
    })),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML for the debug page.
function toHtml(b) {
  const angles = b.jack.angles.map((a) => `<li><b>${esc(a.name)}:</b> ${esc(a.rule)}</li>`).join('');
  const rules = b.jack.rules.map((r) => `<li>${esc(r)}</li>`).join('');
  const lines = b.jack.lines.map((l) => `<li>${esc(l.name)}: ${esc(l.down)}. ${esc(l.height)}.</li>`).join('');
  const chars = b.characters.map((c) => `<li><b>${esc(c.label)}</b> (${esc(c.key)}): ${esc(c.desc)}</li>`).join('');
  const rows = b.pages
    .map((p) => `<tr><td>${p.n}</td><td>${esc(p.textZone)}</td><td>${esc(p.angle)}</td><td>${p.scale}</td><td>${esc(p.characters.join(', ') || 'none')}</td><td>${esc(p.facing)}</td></tr>
    <tr><td colspan="6"><details><summary>Jack prompt, page ${p.n}</summary><pre style="white-space:pre-wrap">${esc(p.jackPrompt)}</pre></details></td></tr>`)
    .join('');
  return `<div class="row" id="bible">
  <h3>Character bible</h3>
  <p>This is the source for Jack's drawing prompts. The prompts below are the exact text sent.</p>
  <h4>Jack</h4>
  <p>Clothes: ${esc(b.jack.clothes)}</p>
  <ul>${angles}</ul>
  <ul>${rules}</ul>
  <ul>${lines}</ul>
  <h4>Side characters</h4>
  <ul>${chars}</ul>
  <h4>Pages</h4>
  <table border="1" cellpadding="4" style="border-collapse:collapse;font-size:14px;width:100%">
    <tr><th>Page</th><th>Text</th><th>Jack angle</th><th>Scale</th><th>Characters</th><th>Jack facing</th></tr>
    ${rows}
  </table>
</div>`;
}

module.exports = { JACK, jackPrompt, build, toHtml };
