# The cast's style

One look for every character, set by Onibi ([../scripts/cast/onibi.mjs](../scripts/cast/onibi.mjs)). Everything here
is a rule; break one only if the user changes the style for the whole cast.

## Medium

- **Pixel art on a 64×64 grid.** Hard pixels only: no gradients, no blur, no anti-aliasing, no soft glows. Exports
  scale up with nearest neighbour (`encodePng(rgb, 8)` for 512).
- **The kit's palette** (`PALETTE` in [../scripts/pixel-kit.mjs](../scripts/pixel-kit.mjs)) for everything. A character
  may add up to six accent keys of its own, taken from the night-city theme's colours: violet `#B79CF0`, peach
  `#F5B97A`, mint `#8FDDB0`, coral `#F2788C`, yellow `#F5D07A`, blue `#7AA7F0`, each with one darker step for shadow.
  Pink `P` and teal `T` stay the cast's neon.
- **Two shades per material** (base and shadow, plus a highlight where light hits). Dither (checkerboard) only on the
  boundary between two shades.

## Framing

- **Head-and-shoulders close-up** that fills the frame: face about 30px wide, eye line around rows 27–29, shoulders
  leaving the bottom edge. The face and the hook must read at 48px.
- **Adult proportions.** No chibi heads, no big cute eyes.
- **Expression with edge:** a glare, a flat stare, a hidden mouth. Nobody in Night City smiles for the camera.

## Light

- **Teal from the left** (the street signs), **pink from the right** (the character's own light: an implant, a screen,
  a weapon). The `haze` behind the head sits on the pink side.
- **Neon** is a bright pixel with a dim neighbour (`P`/`p`, `T`/`t`), never a blur.
- Skin gets a teal-lit left edge (`c`) and a shadowed right edge (`s`).

## Finish (always, in this order)

1. `haze(bg, cx, cy)`: night sky with a dithered pink haze around the light source.
2. `compose(bg, fig)`: the 1px `O` outline around the figure. Interior lines are placed by hand.
3. `rimLight(grid, silhouetteSpans, from, to)`: teal and pink rim on the outer silhouette (hood, helmet, hair, shoulders).
4. `glitchTear(rgb, { rows: [eye line, eye line + 1], back: [one row lower] })`: the tear across the eyes.
5. `finish(rgb)`: CRT scanlines.

## Checklist before showing a draft

- Only palette keys plus at most six accents (`toRgb` throws on unknown keys).
- One hook, readable at 16px on the preview sheet; the face still reads at 48px.
- At least one pink and one teal element on the figure itself.
- A silhouette that differs from every character in [cast.md](cast.md).
- Adult proportions and a face with edge; no gradients or soft shading crept in.
