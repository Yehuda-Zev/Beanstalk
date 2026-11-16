// The character bible. Two parts:
// 1. The generic Jack drawn into every shared background: his look, and his pose, facing,
//    expression and size on each page. Backgrounds are drawn from this.
// 2. The child's Jack sheet, made from an uploaded photo. Only his head, face and hair are
//    taken from it and swapped onto the generic Jack on each page.

const story = require('./story');
const template = require('./template');

// Kept plain on purpose: short hair, no glasses or beard, so the child's features replace it cleanly.
const GENERIC_JACK =
  'Jack, a boy of about ten with a plain, ordinary face, short neat brown hair, no glasses, no beard, ' +
  'light skin. ' + story.JACK_CLOTHES;

// Jack's line in a background prompt, for one page.
function jackLine(page) {
  const j = page.jack;
  const parts = [`Jack is in this picture: ${GENERIC_JACK}`, `Pose: ${j.pose}.`, `Facing: ${j.facing}.`,
    `Expression: ${j.expression}. His face must clearly show it, and must not smile unless that says so.`];
  if (!j.hidden) {
    if (template.isLying(page)) parts.push('He is lying down, horizontal.');
    else {
      const pct = Math.round((template.jackRect(page).h / template.SIZE) * 100);
      parts.push(`He stands with his feet on the floor, about ${pct}% of the picture height from head to boots.`);
    }
  }
  parts.push('His whole head and face are clearly visible, not covered, and in the middle third of the picture.');
  return parts.join(' ');
}

function build(book) {
  const names = [...new Set(book.pages.flatMap((p) => p.characters))];
  return {
    generic: GENERIC_JACK,
    characters: names.map((key) => ({ key, label: story.CHARACTERS[key].label, desc: story.CHARACTERS[key].desc })),
    pages: book.pages.map((p) => ({ n: p.n, caption: p.caption, jack: jackLine(p) })),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toHtml(b) {
  const chars = b.characters.map((c) => `<li><b>${esc(c.label)}</b>: ${esc(c.desc)}</li>`).join('');
  const pages = b.pages.map((p) => `<li><b>Page ${p.n}.</b> ${esc(p.jack)}</li>`).join('');
  return `<details class="row" id="bible"><summary><b>Character bible</b> (generic Jack, side characters, Jack on every page)</summary>
  <h4>Generic Jack (drawn into the backgrounds)</h4><p>${esc(b.generic)}</p>
  <h4>Side characters</h4><ul>${chars}</ul>
  <h4>Jack on each page</h4><ol style="list-style:none;padding:0">${pages}</ol>
</details>`;
}

module.exports = { GENERIC_JACK, jackLine, build, toHtml };
