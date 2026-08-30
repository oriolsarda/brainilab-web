# BrainiWord English guess validation

V31 validates BrainiWord guesses in PostgreSQL before an attempt is consumed.

The seed is a common-English five-letter corpus built from the TextBlob English spelling corpus, whose header cites public-domain Project Gutenberg material plus Wiktionary and British National Corpus frequency lists. BrainiLab also automatically adds every word in `brainiword_words` to the legal-guess table.

Runtime design:

```text
player enters 5 letters
→ check_brainilab_brainiword_guess(...)
→ brainiword_valid_guesses
→ invalid: no row consumed
→ valid: return Wordle-style letter states
```

This deliberately avoids a third-party dictionary API on every keystroke/guess, so the Daily game does not depend on another website being online or fast.

If a legitimate word needs to be added later, insert it into `public.brainiword_valid_guesses` through a controlled admin/backend migration.
