// All prompt text lives here. STYLE and the character strings are reused verbatim on every call.

const STYLE =
  'Modern 3D animated feature film style: rounded forms, large expressive eyes, soft rim light.';

const JACK_CLOTHES =
  'Jack wears a brown vest over a white shirt, green trousers, and brown boots.';

// Side characters: text-only descriptions, turned into one sheet each per book.
const CHARACTERS = {
  mother: {
    label: 'Jack\'s mother',
    desc:
      'a kind, tired woman in her 40s with brown hair in a bun, a patched green apron over a faded blue dress, gentle face',
  },
  oldMan: {
    label: 'the old man',
    desc:
      'a small, wrinkly old man with a long white beard, a crooked purple hat, a patched grey cloak, twinkling sly eyes',
  },
  cow: {
    label: 'Milky-White the cow',
    desc:
      'a gentle white cow with brown patches, a pink nose, big sleepy eyes, and a rope halter',
  },
};

// Same bean description on pages 2 and 3 so the beans match.
const BEANS =
  'exactly five small, smooth, oval magic beans, each a different bright colour: one red, one orange, one yellow, one blue, one purple (no more, no fewer than five)';

const HANDS =
  'Hands (critical): every visible hand has exactly five fingers (four fingers and one thumb), drawn as soft, rounded, simple shapes. No extra, missing, or merged fingers. Keep hands in clear, simple poses.';

const BEAN_COUNT =
  'Bean count (critical): there are exactly 5 beans, no more and no fewer. Count them: 1 red, 2 orange, 3 yellow, 4 blue, 5 purple. Never four, never six. All five must be fully visible.';

const NO_TEXT = 'Avoid: any text, letters, watermarks, split panels.';

function jackSheetPrompt() {
  return `Character reference sheet of Jack, a child based on the person in Image 1. Three poses side by side on a plain light background: front view, three-quarter view, side view. Same child, same face, same clothes in all three.
${JACK_CLOTHES}
Match the face in Image 1: face shape, eye spacing, nose, mouth, hairstyle, hair color, skin tone, age, glasses, facial hair. Redraw it in the style below; do not copy the photo's pixels or lighting.
Style: ${STYLE}
${NO_TEXT}`;
}

function sideSheetPrompt(key) {
  const c = CHARACTERS[key];
  return `Character reference sheet of ${c.label}: ${c.desc}. Front view and three-quarter view side by side, full body, on a plain light background. Same character in both views.
Style: ${STYLE}
${NO_TEXT}`;
}

// refs lists which images follow the photo + Jack sheet, in order.
const PAGES = [
  {
    n: 1,
    caption: 'Jack and his mother had nothing left to sell but Milky-White.',
    textZone: 'bottom',
    refs: ['mother', 'cow'],
    expressions:
      'Jack: clearly worried and uncertain, brows tilted up in the middle, eyes anxious, mouth pressed in a small downturned line. Jack\'s mother: sad and weary, eyes lowered, gentle drooping smile. Milky-White: calm.',
    scene:
      'Jack and his mother stand in a bare cottage kitchen with empty cupboards and an empty table. Jack is in full face view, front-lit, looking at his mother. The open door shows Milky-White the cow standing outside in the yard.',
    layout:
      'Keep the lower third of the picture quiet and uncluttered (plain floor, soft shadow) so text can be placed there.',
    palette: 'Warm, soft morning light.',
  },
  {
    n: 2,
    caption: '"Five magic beans," said the old man. "For one cow."',
    textZone: 'top',
    refs: ['oldMan', 'cow'],
    beans: true,
    expressions:
      'Jack: curious and hopeful, eyes wide and bright, eyebrows raised, a small eager smile. The old man: a sly, knowing grin with one eyebrow raised. Milky-White: calm, unaware.',
    scene:
      'A dirt road leading to market. An old man holds out his open palm showing ' + BEANS + ', all five clearly visible and separate from each other. Jack, in the same clothes as the previous page, holds the cow\'s rope. Jack is in three-quarter view, looking at the beans.',
    layout:
      'Keep the top third of the picture as open, quiet sky so text can be placed there.',
    palette: 'Warm, soft daylight.',
  },
  {
    n: 3,
    caption: '"Beans!" she cried. And out the window they went.',
    textZone: 'bottom',
    refs: ['mother'],
    beans: true,
    expressions:
      'Jack\'s mother: mouth wide open, shouting in anger and anguish, brows pulled hard together, eyes squeezed with distress, face twisted. Jack: shocked and frightened, eyes very wide, eyebrows lifted high, mouth hanging open in a gasp.',
    scene:
      'The cottage at dusk. Jack\'s mother leans out of an upstairs window, throwing ' + BEANS + ', identical in shape, colour and size to the beans in the previous page. All five beans are in the air or scattering onto the garden below. Jack stands at the cottage doorway, watching.',
    layout:
      'Keep the lower third of the picture as dark, quiet grass so text can be placed there.',
    palette: 'Darker dusk palette: deep blues and purples with a warm glow from the window.',
  },
];

function pagePrompt(page) {
  // Image 1 = photo, Image 2 = Jack sheet, Image 3+ = page.refs in order.
  const refLines = page.refs
    .map((k, i) => `Image ${i + 3} is the reference sheet for ${CHARACTERS[k].label}.`)
    .join(' ');
  const beanLine = page.beans ? BEAN_COUNT + '\n' : '';
  return `${beanLine}Scene: ${page.scene}
Characters: Jack is the same child as in Image 2 (same face shape, hair, skin tone, clothes), but his expression comes from the expressions line below. Image 1 is the original photo; use it only to match facial structure, never its pixels or lighting. ${refLines} Use the photo and every reference sheet for identity only (face shape, features, hair, skin tone, clothes). They show neutral faces: ignore their expressions and poses completely.
${JACK_CLOTHES}
Facial expressions (most important; draw them large and clearly readable, exaggerated like a 3D animated film): ${page.expressions}
${HANDS}
Palette: ${page.palette}
Composition: full-bleed storybook page, square. ${page.layout}
Style: ${STYLE} Draw every character in this same style, with consistent shading and rim light.
${NO_TEXT}`;
}

module.exports = {
  STYLE,
  CHARACTERS,
  PAGES,
  jackSheetPrompt,
  sideSheetPrompt,
  pagePrompt,
};
