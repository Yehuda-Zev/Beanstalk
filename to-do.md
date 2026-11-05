# To-do

- **Only Jack's character picture is shown for approval.** The mother, old man and cow sheets are never checked, so they can still drift between pages.
- **No retry if one page call fails.** One failed call fails the whole book.
- **Make Generator page look nice** Don't just have a styleless form; give it character!
- **Jack only looks liek me a little** Maybe try tweaking the prompt to get closer likeness to original image.
- **No way to delete a book or an account.** The privacy page says to email for deletion; there is no delete button yet.
- **Books are stored as PDFs inside Postgres.** Fine for 3 pages (pages are saved as JPEG to keep them small), but a 20-page book will be much bigger and Neon's free plan is 0.5 GB. Watch the size.
- **Login only tested with simulated sessions.** Test the real Google flow with a second Gmail account, including on the live site.
- **Rate limit is per user (3 books/hour). The 30/day cap is global and resets on restart.**

- **Approval step costs more and adds a round trip.** The other characters are drawn only after approval, so the second phase is slower. Could draw them while the user reviews.
- **Photo crop idea dropped.** A saliency crop could cut off hair or chin. A real tight face crop needs face detection.
