# Designing a character

What made Onibi work after several misses, as rules for the next one.

## A concept is a role, a hook, an edge and a silhouette

- **Role:** who they are in Night City. Netrunner, fixer, ripperdoc, techie, nomad, solo, media, rockerboy, corpo
  defector, trauma medic, street kid, fence, courier. Pick what matches the project's job: a code-review tool is a
  ripperdoc who inspects implants, a deploy tool a courier, an account switcher a fixer with many faces.
- **Hook:** one signature element that stands for what the project does and is visible at 16px. Onibi's chrome
  cybereye is the eight-point spark, Claude ×100. Without a hook a character is "a girl in a city".
- **Edge:** what makes them dangerous or unsettling: a mask over the mouth, visible cyberware, a scar, a weapon, a
  cold stare. Cute, cheerful or chibi reads wrong in this world.
- **Silhouette:** what you recognise when it's black: a hood, a helmet, a mohawk, a wide-brimmed hat, a collar, a
  headset, an undercut. Each character needs a different one.

## Reading feedback

| The user says                     | It usually means          | Do                                                        |
| --------------------------------- | ------------------------- | --------------------------------------------------------- |
| "just circles and polygons"       | shapes, not a person      | give the face anatomy: eyes, brows, nose, mouth, jaw      |
| "it's a picture, not a character" | no attitude, pose or prop | add a hook and an expression                              |
| "not proportional", "too happy"   | chibi or cute crept in    | adult proportions, a hard or hidden expression            |
| "strange style", "a mixture"      | style drift               | re-read style.md; remove whatever isn't pixel art         |
| "a girl in a city", "no edge"     | no hook, too wide a shot  | signature cyberware or gear, tighter crop, glitch, a mask |
| "not real", "not awesome"         | generic                   | push the hook: make it part of the body, not an accessory |

Two misses on the same note: stop guessing and ask for a reference character whose vibe is closest.

## Naming

- **Handle (public):** short, dark, a warning. Not English or Western by default; Japanese matches the city (the
  ナイトシティ sign) and pairs a kanji with a meaning: Onibi (鬼火, "demon fire": ghost lights that lead people to their
  end). Other languages work when they fit (Sanskrit, Russian, Korean). Avoid handles that already belong to a famous
  character, and avoid clever-but-cute ones (Onibi was nearly "Octet"; it was too nice).
- **Real name (private):** from a brighter past, deliberately unsuited to who they are now: soft, warm, hopeful, the
  name their parents chose. It stays in chat and never goes into a file, commit, PR, alt text or cast.md.
- Offer four to six options with meanings and a recommendation, then let the user pick or mix.
