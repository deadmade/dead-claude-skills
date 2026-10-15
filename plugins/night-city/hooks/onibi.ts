// Onibi drops by: now and then, after a main turn, she says one line in the band above the prompt.
import { hash, pick } from './words';

export const VISIT_MS = 6_000;
export const COOLDOWN_MS = 3 * 60_000;
export const CHANCE = 0.2;
export const SLOW_MS = 2 * 60_000;

export const LINES: readonly string[] = [
  'good work, choom.',
  'what are you even doing?',
  'that was clean. suspiciously clean.',
  "i'm bored. break something.",
  'is this production? asking for a fixer.',
  'nice code. jk.',
  'you should drink some water, netrunner.',
  'the corpos would never ship this. respect.',
  'did you test that? i saw nothing.',
  'my eye is glowing. that means approval.',
  'keep going, the city never sleeps.',
  'eddies well earned.',
  'who wrote this? oh. you.',
  'i would have done it faster. maybe.',
];

export const FLATLINED: readonly string[] = [
  'flatlined again?',
  'ouch. i felt that through the net.',
  'errors are just ICE with feelings.',
];

export const SLOW: readonly string[] = ['took you long enough.', 'i aged a year in there.', 'was that a braindance?'];

export type Mood = 'idle' | 'flatlined' | 'slow';

// The dice are the turn id, random in a session and chosen in a test (Math.random can't be stubbed there).
// The low digits: FNV-1a leaves the high bits of short seeds barely mixed.
export const roll = (seed: string) => (hash(seed) % 1000) / 1000;

// The `onibi` setting: `sometimes` is at most one visit per cooldown, `always` every main turn.
export type Cadence = 'off' | 'sometimes' | 'always';
export const cadence = (value: unknown): Cadence => (value === 'off' || value === 'always' ? value : 'sometimes');

export const shouldVisit = (how: Cadence, now: number, lastAt: number, seed: string) =>
  how === 'always' || (how === 'sometimes' && now - lastAt >= COOLDOWN_MS && roll(seed) < CHANCE);

export const lineFor = (mood: Mood, seed: string) =>
  pick(mood === 'flatlined' ? FLATLINED : mood === 'slow' ? SLOW : LINES, `${seed}:line`);

// A three-row Onibi: hood, the cyan spark of her cybereye, the respirator. Colours from scripts/draw-mascot.mjs.
export const SPRITE: readonly (readonly [string, string])[][] = [
  [[' ▄▆▆▄ ', '#3A3058']],
  [
    ['▐', '#3A3058'],
    ['✦', '#7CCFE0'],
    ['▀▀', '#D2AEC6'],
    ['▌ ', '#3A3058'],
  ],
  [
    [' ', '#3A3058'],
    ['▀▓▓▀', '#5A5478'],
    [' ', '#3A3058'],
  ],
];
export const NEON = '#F08BB4';
