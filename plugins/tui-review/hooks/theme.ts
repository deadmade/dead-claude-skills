// Colours, 0xRRGGBB, or DEFAULT for the terminal's own. Style ids follow brv/src/styles.rs; keep the order.

export const DEFAULT = 0x01000000

export const styleFg: readonly number[] = [
  DEFAULT, // plain
  0xc678dd, // keyword
  0x98c379, // string
  0x7f848e, // comment
  0x61afef, // function
  0xe5c07b, // type
  0xd19a66, // number
  0xd19a66, // constant
  0x56b6c2, // operator
  0xabb2bf, // punctuation
  DEFAULT, // variable
  0xe06c75, // property
  0xd19a66, // attribute
  0xe06c75, // tag
  0x56b6c2, // builtin
  0x56b6c2, // escape
]

export const theme = {
  barFg: 0xdcdfe4,
  barBg: 0x2c313c,
  fileFg: 0xffffff,
  fileBg: 0x3b4252,
  viewedFg: 0x98c379,
  viewedBg: 0x2a2f38,
  hunkFg: 0x56b6c2,
  gutterFg: 0x636d83,
  addBg: 0x1e3a2a,
  delBg: 0x3f2226,
  addSign: 0x98c379,
  delSign: 0xe06c75,
  dimFg: 0x7f848e,
  cursorBg: 0x3e4451,
  commentFg: 0xe5c07b,
  noteFg: 0xdcdfe4,
  noteBg: 0x2f2b1f,
} as const
