export const SPINNER_WORDS: readonly string[] = [
  'Breaching ICE',
  'Jacking in',
  'Running the net',
  'Spoofing the Blackwall',
  'Slicing the firewall',
  'Dialing the fixer',
  'Scanning the braindance',
  'Overclocking the deck',
  'Pinging the netrunner',
  'Hacking the mainframe',
  'Rerouting through the grid',
  'Splicing the datastream',
  'Cracking the cipher',
  'Riding the neon',
];

// Past tense, so each reads before "for 3s".
export const TURN_WORDS: readonly string[] = [
  'Jacked out',
  'Flatlined the bug',
  'Ghosted the ICE',
  'Breached the Blackwall',
  'Ran the net',
  'Cleaned the trace',
  'Fried the firewall',
  'Cashed the eddies',
  'Slipped past the corpos',
  'Wired the deck',
  'Sliced through',
  'Zeroed the daemon',
];

// FNV-1a over the seed, so one seed always lands on one word.
export function pick(words: readonly string[], seed: string): string {
  let h = 0x811c9dc5;
  for (const c of seed) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return words[h % words.length]!;
}
