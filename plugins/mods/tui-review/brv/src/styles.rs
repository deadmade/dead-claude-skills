//! Highlight styles: the ids `.hl` spans carry. The mod's theme (`hooks/theme.ts`) maps each to a colour, so keep the
//! two lists in the same order.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Style {
    Plain = 0,
    Keyword = 1,
    String = 2,
    Comment = 3,
    Function = 4,
    Type = 5,
    Number = 6,
    Constant = 7,
    Operator = 8,
    Punctuation = 9,
    Variable = 10,
    Property = 11,
    Attribute = 12,
    Tag = 13,
    Builtin = 14,
    Escape = 15,
}
