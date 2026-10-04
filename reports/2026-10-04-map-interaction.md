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

## Completed cloud synchronization

- Private `main`: implementation `094817c`, desktop-only layout correction `e1d493e`; both pushed and the remote SHA verified equal to local.
- The user explicitly chose to synchronize only the existing website and private repository. The public `mutuals` repository was left unchanged.
- Maincloud publication succeeded with `--delete-data=never`. Migration replaced only the `my_event_map_pins` view to add its headline column; persisted tables were retained. Existing clients reconnect after this view schema update.
- Boundary update succeeded through `set_networking_event_area`; saved coordinates:
  `[[42.2892875,-83.7197725],[42.2892875,-83.7115275],[42.2948125,-83.7115275],[42.2948125,-83.7197725]]`.
  Other boundaries were compared before/after and preserved.
- Vercel deployment `dpl_54jqGzwe7qM3V9ZvQanjLJuJgxX9`: `READY`, production [mutuals.tech](https://mutuals.tech/).
- Production desktop at 1280x800: `Live sync`; centered boundary height 528px within 676px of unobstructed height, about 78%. Continuous zoom reaches its disabled upper control with native level-19 tiles scaled 16x, verifying zoom 23; no tile load errors observed.
- Cloud provider check: ASI, Pinecone write/fetch/query and cleanup all pass. Storage check: 11 map profiles, 9 private profiles, 9 indexed vectors; all vectors present.
- Production had no current live participants at the final check. Actual name/headline focus behavior and 6px/no-shadow dots were verified earlier against live participants on the local desktop preview; profile fallbacks and bounds are covered by the passing tests.
- Desktop screenshot: ignored local `reports/map-desktop-center.png`.
