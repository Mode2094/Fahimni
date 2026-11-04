# UX & Accessibility Review (Phase 7)

## Design system
The product uses a single design system (`app/design-system.css`, `fn-*` classes)
with `components/fahimni/*` primitives, RTL-first (`<html dir="rtl" lang="ar">`),
logical CSS properties, the Baloo Bhaijaan 2 display face and IBM Plex Sans
Arabic body. New screens (subscription, top-up, widget, admin readiness, legal)
reuse these primitives, so the newer pages match the platform.

## Screens reviewed
Landing, login, onboarding (grade/track), student dashboard, subject catalogue,
subject detail, classroom/whiteboard, image & voice recognition, subscription,
top-up store, expired/exhausted states, admin console, and the new Launch
Readiness and legal pages.

## Improvements in this branch
- **Credit clarity:** the subscription page explains how credits work (costs,
  order of deduction, expiry vs durable purchased credits); the classroom shows
  one unobtrusive low-credit notice and one clear exhausted action (“اشحن رصيدًا
  إضافيًا”).
- **Subscription page** presents ONE offer (name, price, exact dates, included
  subjects, credits) with one primary action — no multi-plan pricing tables.
- **Dashboard widget** shows status, end date, remaining days and the unified
  balance with a single next action.
- **Launch Readiness** gives the owner a plain-language Arabic checklist with the
  exact action per item.
- **Legal pages** are consistent, navigable and clearly labelled.

## Accessibility
- Meaningful ARIA labels on interactive controls; `role="status"` / `role="alert"`
  for notices; dialogs use `aria-modal` and focus management.
- Keyboard: Escape closes dialogs; forms are native; focus-visible styles present.
- Reduced motion honoured by the design system.
- Bidi: numeric/ID/email rendered `dir="ltr"`; Arabic/Latin/math mixed content
  handled.

## Responsive verification
Layouts use the system grid (`fn-grid--2/3/4`, container + gutter tokens) and are
designed mobile-first at 390px, tablet 768px and desktop 1440px. The subscription
and top-up pages stack to a single column on mobile.

## Testing limitations (honest)
- No browser-automation dependency ships in the repo, so visual QA here is via
  jsdom component tests (`unified-subscription-ui.test.ts`) plus the existing
  committed manual browser evidence under `docs/reviews/phase-1-screenshots/`.
- A real-browser pass (Playwright) at 390/768/1440 on a deployed staging URL is
  recommended before launch and is listed as an owner/staging step.
