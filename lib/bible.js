// The character bible: every look, size, angle and floor line the pictures are drawn from.
// It is built from the same story and template text the prompts use, so it always matches them.

const story = require('./story');
const template = require('./template');

const FLOOR_NAMES = {
  top: 'Floor line for pages whose caption is at the top',
  bottom: 'Floor line for pages whose caption is at the bottom',
  lying: 'Bed line for pages where Jack lies down',
};

function build(book) {
  const names = [...new Set(book.pages.flatMap((p) => p.characters))];
  return {
    title: book.title,
    jack: {
      clothes: story.JACK_CLOTHES,
      angles: [
        { name: 'upright', rule: 'Standing, full body. His feet sit on the floor line for the page.' },
        { name: 'lying', rule: 'Horizontal, lying down (for example asleep in bed). Wider than tall. His body rests on the bed line.' },
      ],
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
      angle: (p.jack && p.jack.angle) || 'upright',
      facing: (p.jack && p.jack.facing) || '',
      scale: (p.jack && p.jack.scale) || 1,
    })),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML for the debug page.
function toHtml(b) {
  const angles = b.jack.angles.map((a) => `<li><b>${esc(a.name)}:</b> ${esc(a.rule)}</li>`).join('');
  const lines = b.jack.lines.map((l) => `<li>${esc(l.name)}: ${esc(l.down)}. ${esc(l.height)}.</li>`).join('');
  const chars = b.characters.map((c) => `<li><b>${esc(c.label)}</b> (${esc(c.key)}): ${esc(c.desc)}</li>`).join('');
  const rows = b.pages
    .map((p) => `<tr><td>${p.n}</td><td>${esc(p.textZone)}</td><td>${esc(p.angle)}</td><td>${p.scale}</td><td>${esc(p.characters.join(', ') || 'none')}</td><td>${esc(p.facing)}</td></tr>`)
    .join('');
  return `<div class="row" id="bible">
  <h3>Character bible</h3>
  <p>Generated from the book text, so it matches what the prompts use.</p>
  <h4>Jack</h4>
  <p>Clothes: ${esc(b.jack.clothes)}</p>
  <ul>${angles}</ul>
  <ul>${lines}</ul>
  <h4>Side characters</h4>
  <ul>${chars}</ul>
  <h4>Pages</h4>
  <table border="1" cellpadding="4" style="border-collapse:collapse;font-size:14px">
    <tr><th>Page</th><th>Text</th><th>Jack angle</th><th>Scale</th><th>Characters</th><th>Jack facing</th></tr>
    ${rows}
  </table>
</div>`;
}

module.exports = { build, toHtml };
