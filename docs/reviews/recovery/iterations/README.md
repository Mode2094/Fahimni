These are discarded development iterations, not accepted final lessons.

- `invalid-generated-geometry`: the actual configured provider returned correct text coordinates but placed P at (-1.05,0.85), omitted axes and used an incorrect large angle arc. This output is the regression input for `tests/visual-math-check.test.ts`.
- `invalid-generated-notation`: an actual follow-up contained invisible RTL marks and a stray Thai character inside mathematical notation. Strict math-script validation now rejects those strings. Follow-ups reuse server-verified visual references instead of copying mathematical notation from the text model.

All identities, books and wallet changes belong to the isolated recovery database. The cumulative provider usage report includes these failed iterations. Accepted final real-provider evidence is under `../live/`; renderer and browser fixtures are under `../after/`.
