// Curated seed dictionary for the "not based on a dictionary word" password rule
// (src/passwordPolicy.ts). Kept in its own module so it can be DYNAMICALLY imported
// only when a password UI mounts — it never enters the portal's landing bundle.
//
// Contents: the most common weak passwords plus frequent base words (names, months,
// seasons, colors, animals, sports, and a few ABA-domain terms) that passwords are
// commonly built from. All entries are lowercase and ≥4 chars (the validator only
// compares letter-run substrings of length ≥ DICT_MIN_RUN). This is a pragmatic
// seed — extend it (or swap for a generated list) without touching the validator.
const WORDS = `
password passwd letmein welcome admin administrator login logon guest
qwerty qwertyuiop asdf asdfgh zxcv zxcvbn azerty
dragon monkey master shadow superman batman spiderman trustno hunter ranger
buster soccer hockey killer mustang corvette ferrari harley diamond phoenix
football baseball basketball soccer tennis golfer bowling
princess sunshine iloveyou loveyou lover flower cookie chocolate cheese pizza
coffee guitar ninja samsung google apple banana orange purple yellow silver
golden bronze secret sesame changeme default temporary
summer winter spring autumn season
january february march april june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
michael jennifer jessica joshua matthew andrew daniel joseph david robert john
james william thomas charles christopher chris steven kevin brian george edward
sarah ashley amanda melissa nicole elizabeth stephanie rebecca laura emily hannah
mother father brother sister family friend friends
house home school office work worker manager teacher student
money dollar cash bank account credit finance
ocean river lake mountain forest garden flower thunder lightning storm rainbow
warrior wizard angel devil heaven magic power energy victory champion legend hero
panther tiger eagle falcon cobra viper raptor lion bear wolf shark
computer internet network server system windows android iphone laptop
therapy schedule session client behavior behaviour analyst dashboard patient
whatever nothing everything anything someone anyone forever always never
freedom liberty america country nation world global united
hello world universe galaxy planet earth moon star space rocket
`
  .trim()
  .split(/\s+/);

export const PASSWORD_DICT: ReadonlySet<string> = new Set(WORDS);
