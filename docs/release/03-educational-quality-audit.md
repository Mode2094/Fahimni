# Curriculum Readiness Matrix — FAHIMNI

Status: generated from the real seeded catalogue and book store. **Do not
advertise a subject as available unless it appears as READY below.** No textbook
is fabricated; missing subjects are listed as not ready with the exact action to
make them available.

## How readiness is decided

A subject appears to students and can be sold inside the unified semester
subscription only when **all** hold:

1. The subject is a member of the student's grade and academic track
   (`subjectAppliesToScope`).
2. The subject is active in the catalogue.
3. The subject has a book whose status is **READY** (`findReadyBookBySubject`).

The subscription/checkout code filters on (3) at read time, so a subject without
a READY book is never promised or sold.

## Seeded catalogue (as of this release)

Authoritative source: `db/seed.ts` (idempotent).

| Grade | Academic track | Subject (slug) | Book status | Available to students? |
| --- | --- | --- | --- | --- |
| الصف الحادي عشر (grade-11) | — | *(none defined)* | — | No |
| الصف الثاني عشر (توجيهي) | scientific-technological | رياضيات التوجيهي (`tawjihi-math`) | READY only if a book was uploaded and indexed | Only when READY |
| الصف الثاني عشر (توجيهي) | medical | *(none defined)* | — | No |
| الصف الثاني عشر (توجيهي) | literary | *(none defined)* | — | No |
| الصف الثاني عشر (توجيهي) | business | *(none defined)* | — | No |

**Reality:** the catalog defines only `tawjihi-math` as a subject. Every other
subject for every grade and track is **not defined and not ready**. The bundle of
four Tawjihi fields exists, but only one subject is seeded, so a student in any
other field currently sees no available subject.

## Content-import checklist (owner action)

For each subject the owner wants to launch:

1. Create the grade (admin → الصفوف) if it does not exist.
2. Create the academic track (admin → الحقول) for the grade.
3. Create the subject (admin → المواد) with grade + track + name + slug.
4. Confirm distribution rights for the textbook (licence or owner-supplied
   content). **Do not upload a book you are not authorised to distribute.**
5. Upload the PDF (admin → المادة → كتاب المادة). It is staged, validated, then
   promoted only on a fully successful index.
6. Wait for the indexing worker to reach READY (status shown in admin).
7. Add the subject to a semester scope (the unified subscription covers every
   READY subject of the grade/track automatically).
8. Verify the subject appears on the student subscription page for a test
   student in that grade/track.

## What is intentionally NOT done

- No invented Jordanian textbooks were added.
- No subject is marked READY without a real, indexed book.
- Subjects for which the owner lacks rights are left out rather than promised.

## Licensing requirement

Every production textbook must have a documented distribution right. Until then
the corresponding subject stays not-ready and is never advertised or sold.
