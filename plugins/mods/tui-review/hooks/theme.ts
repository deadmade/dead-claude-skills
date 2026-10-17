// Colours, 0xRRGGBB, or DEFAULT for the terminal's own. Style ids follow brv/src/styles.rs; keep the order.

export const DEFAULT = 0x01000000;

export const styleFg: readonly number[] = [
  DEFAULT, // plain
  0xc79af0, // keyword
  0x8fddb0, // string
  0x9a90c2, // comment
  0x7aa7f0, // function
  0xf5d07a, // type
  0xf2a36b, // number
  0xf2a36b, // constant
  0x7ccfe0, // operator
  0xbdb4de, // punctuation
  DEFAULT, // variable
  0xf08bb4, // property
  0xf2a36b, // attribute
  0xf08bb4, // tag
  0x7ccfe0, // builtin
  0x7ccfe0, // escape
];

// Night City (plugins/mods/night-city/themes/night-city.json).
export const theme = {
  barFg: 0xe6dcf7,
  barBg: 0x2a2340,
  fileFg: 0xe6dcf7,
  fileBg: 0x362d52,
  viewedFg: 0x8fddb0,
  viewedBg: 0x221c33,
  hunkFg: 0x7ccfe0,
  gutterFg: 0x7a71a6,
  addBg: 0x1e3631,
  delBg: 0x42213a,
  addSign: 0x8fddb0,
  delSign: 0xf2788c,
  dimFg: 0x9a90c2,
  cursorBg: 0x463a6e,
  commentFg: 0xf5b97a,
  noteFg: 0xe6dcf7,
  noteBg: 0x3a3024,
} as const;
