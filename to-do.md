# To-do

Things in this build that still need work (fill in after you test with real photos):

- **Jack's face may drift by page 3.** Each page gets the photo plus one character sheet, but nothing checks the result. Need to test with several real photos and compare pages 1 vs 3.
- **Character sheets are never inspected.** If the Jack sheet comes out wrong, all three pages inherit the error. Should show the sheet to the user (or regenerate) before painting pages.
- **Side characters can drift on text-only sheets.** The mother must match between pages 1 and 3; only the sheet holds her together.
- **Image quality is set to `low` to save cost.** Faces look softer than they could. Try `medium` for pages via `IMAGE_QUALITY`.
- **Style string is untuned.** Need to test the 3D wording in the Playground to see what each style word actually does.
- **Text readability relies on a dark gradient band.** It works on any art, but looks heavy on page 2's bright sky. Better: tune scene prompts so the text zones are naturally quiet, and fade the band.
- **Jobs live in server memory.** A Render restart loses finished PDFs, and it breaks with more than one instance. Fine for homework, not for real use.
- **Only 3 story pages.** Page 4 (beanstalk at dawn) is not built. New pages are just new entries in `lib/story.js`, but the 20-page book needs more cost/time handling.
- **Fonts are the built-in Helvetica.** No storybook font yet.
- **No retry if one page call fails.** One failed call fails the whole book.
