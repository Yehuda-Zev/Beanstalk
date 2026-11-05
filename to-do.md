# To-do

- **Character sheets are never inspected.** If the Jack sheet comes out wrong, all three pages inherit the error. Should show the sheet to the user (or regenerate) before painting pages.
- **No retry if one page call fails.** One failed call fails the whole book.
- **Make Generator page look nice** Don't just have a styleless form; give it character!
- **Jack only looks liek me a little** Maybe try tweaking the prompt to get closer likeness to original image.
- **No way to delete a book or an account.** The privacy page says to email for deletion; there is no delete button yet.
- **Books are stored as PDFs inside Postgres.** Fine for 3 pages (pages are saved as JPEG to keep them small), but a 20-page book will be much bigger and Neon's free plan is 0.5 GB. Watch the size.
- **Login only tested with simulated sessions.** Test the real Google flow with a second Gmail account, including on the live site.
- **Rate limit is per user (3 books/hour). The 30/day cap is global and resets on restart.**
