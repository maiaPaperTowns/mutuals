# Map interaction changes

The user authorized implementation after the other chat finished, and confirmed that the smaller MHacks box means the green event boundary.

- Allow map zoom through level 23, using OpenStreetMap tiles through native level 19. Use fractional zoom for viewport fitting.
- Render people as 6px dots with a 20px transparent hit target. Remove GPS circles and decorative halos. Favorites keep their color and tooltip status.
- On hover/focus, show the name and a short headline. Reuse the existing saved AI headline when no manually saved map headline exists. Only opted-in map profiles appear publicly; event profiles remain scoped to event members. No hover-time AI calls.
- Reduce the existing MHacks area's width and height by 15% about its current center. Save through the existing admin reducer and record old/new coordinates for reversibility. Other event areas keep their geometry.
- Initial overview fits the boundary to about 56% of the available viewport's limiting dimension. Center fits to about 80%, accounting for home overlays and mobile cards. It also releases any participant focus.
- Keep the existing Pre/Post and ASI workflows. Push the current branch and synchronize the website and affected Maincloud module using `--delete-data=never`.

Verify viewport fitting, the absence of circles, profile fallbacks, the existing website suite/build, and live cloud state. The user narrowed the scope to desktop; inspect the deployed map on desktop and leave mobile-specific layout work for later.
