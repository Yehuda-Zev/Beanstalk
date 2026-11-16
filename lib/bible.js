// The character bible. Two parts:
// 1. The generic Jack drawn into every shared background: his look, and his pose, facing,
//    expression and size on each page. Backgrounds are drawn from this.
// 2. The child's Jack sheet, made from an uploaded photo. Only his head, face and hair are
//    taken from it and swapped onto the generic Jack on each page.

const story = require('./story');
const template = require('./template');

const GENERIC_JACK = story.CHARACTERS.jack.desc;

// Jack's line in a background prompt, for one page.
function jackLine(page) {
  const j = page.jack;
  const parts = ['Jack is in this picture, drawn exactly as in his reference sheet.', `Pose: ${j.pose}.`, `Facing: ${j.facing}.`,
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
  const names = ['jack', ...new Set(book.pages.flatMap((p) => p.characters))];
  return {
    characters: names.map((key) => ({ key, label: story.CHARACTERS[key].label, desc: story.CHARACTERS[key].desc })),
    pages: book.pages.map((p) => ({ n: p.n, jack: jackLine(p) })),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The bible on the debug page: each character's sheet, description and redraw button, then Jack per page.
function toHtml(b) {
  const chars = b.characters
    .map((c) => `<div class="char">
      <img class="sheet" data-name="${c.key}" src="/debug/sheet/${c.key}" alt="no sheet yet">
      <div><b>${esc(c.label)}</b> (${esc(c.key)})<br>${esc(c.desc)}<br>
      <button type="button" class="sheet-redraw" data-name="${c.key}">Redraw sheet</button></div></div>`)
    .join('');
  const pages = b.pages.map((p) => `<li><b>Page ${p.n}.</b> ${esc(p.jack)}</li>`).join('');
  return `<div class="row" id="bible"><h3>Character bible</h3>
  <p>Every background is drawn from these sheets. Draw them first. Redrawing a sheet does not change backgrounds already drawn.</p>
  ${chars}<div id="side-status" class="status"></div>
  <details><summary>Jack on each page</summary><ol style="list-style:none;padding:0">${pages}</ol></details>
</div>`;
}

module.exports = { GENERIC_JACK, jackLine, build, toHtml };
