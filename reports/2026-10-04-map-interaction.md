# Map interaction update

## Scope and coordination

The other chat completed its Hosted ASI changes before implementation started. Base `807805c` on `main` matched `origin/main`. This change covers Leaflet maps, compact profile projections, and the existing MHacks display boundary. It preserves public profile opt-in and event membership filters.

## Behavior

- Map zoom 23 with native OpenStreetMap tiles through 19; fractional fit and half-level controls.
- People are 6px dots with 20px transparent hit targets; GPS circles and decorative halos removed. Favorites are gold.
- Tooltip shows a name and one short headline. Manual map headlines take precedence; saved AI headlines provide the fallback. Event pins use their existing profile snapshot's headline, limited to 140 characters. No hover-time AI calls.
- Initial boundary overview uses 22% margins. Center uses 10% margins, fitting about 80% of the limiting usable dimension. Existing focus reset is preserved.
- Measured overlays determine the fitted area. The user narrowed this request to desktop, so the extra mobile card layout adjustments were reverted.

## Confirmed MHacks boundary change

Event: `b28eaf12-64c9-4603-b641-4a2936967c2a` (`MHacks`). The user confirmed that the green activity boundary should be smaller.

Old coordinates:
```json
[[42.2888,-83.7205],[42.2888,-83.7108],[42.2953,-83.7108],[42.2953,-83.7205]]
```

Target: scale each offset from center `[42.29205,-83.71565]` by 0.85, reducing each side length by 15%. Use the existing admin reducer, preserve the event ID and all other boundaries, and verify the stored result. These old coordinates provide a direct restore value.

## Verification before cloud synchronization

- Website: 35 tests across 9 files pass; production build passes. Existing large bundle warning remains.
- Native Maincloud module builds. Generated bindings change only the event pin view's headline field.
- Desktop browser: overview boundary height 332px, Center height 471px within a 596px usable height, about 79%. Live dots are 6px without shadows; public name/headline opens on keyboard focus.
- Independent review identified a mobile padding cap; the shared fitting calculation now respects actual measured padding. Mobile-specific layout testing and changes were discontinued when the user clarified desktop-only scope.

Cloud publication and boundary mutation results will be recorded after deployment verification.
