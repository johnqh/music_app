/**
 * For a field whose text is kept exactly as it was typed.
 *
 * The theme draws the library `Input` in upper case with wide tracking,
 * which suits a number or a short label and hides the one thing that
 * matters in a name: a public title typed "Nocturne in c" reads
 * "NOCTURNE IN C" in the field and is published as typed. A name that is
 * stored, shown to other people or compared by case is shown in its own
 * case. Pure presentation — the value was never changed by the theme.
 */
export const AS_TYPED_INPUT_CLASS = 'normal-case tracking-normal';
