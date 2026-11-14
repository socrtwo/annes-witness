# Anchor specification

An **anchor** is an exact spot in a source. This document specifies how anchors are stored, how they are found again after a source changes, how the AI verification gate uses the same machinery, and when a claim becomes Stale. It describes the behavior of `src/core/anchor.ts`, `src/ai/gate.ts` and `src/core/status.ts`; the test vectors in [`tests/anchor-vectors.json`](../tests/anchor-vectors.json) are the normative examples and run in `tests/anchor-vectors.test.ts`.

## 1. Coordinate space

Every source has an **extracted text** (`Source.text`) and a **segment map** (`Source.segments`) that says where each run of that text sits in the original file: a page (`p. 3`, with `page`), a cell (`Sheet1!B4`, with `sheet`, `cell`, `row`, `col`), a paragraph (`¶ 12`), a time span (`00:01:12`, with `timeStart`/`timeEnd`), a slide, a message or a GEDCOM record. Text anchors are character offsets into the extracted text, counted in UTF-16 code units as JavaScript strings are.

## 2. The selector

An anchor stores several selectors at once, so that it survives changes that break any one of them:

| Field | Meaning |
|---|---|
| `start`, `end` | Position selector: half-open range `[start, end)` in the extracted text. |
| `exact` | Quote selector: the passage itself, `text.slice(start, end)`. Empty for a pure region anchor. |
| `prefix`, `suffix` | Up to 32 characters (`CONTEXT`) before and after the passage, used to choose between repeated passages. |
| `rect` | Region selector for pictures and PDF pages: `{ page, x, y, w, h }`, fractions of the page with the origin at the top left. |
| `timeStart`, `timeEnd` | Time selector for recordings, in seconds (the transcript text, if any, is the quote). |
| `sourceHash` | The source's content hash (SHA-256 of the extracted text) when the anchor was made. |
| `broken` | Set when re-anchoring could not find the passage. |

The design follows the W3C Web Annotation model of position plus text-quote selectors, extended with regions, cells and time.

## 3. Normalization

When an exact match fails, text and quote are compared after normalization:

1. Every run of whitespace (spaces, tabs, line breaks, non-breaking spaces and the rest of `\s`) becomes one space.
2. Curly single quotes, primes and the reversed quote (`‘ ’ ‛ ′`) become `'`; curly double quotes and double primes (`“ ” „ ″`) become `"`.
3. Hyphens and dashes (`‐ ‑ ‒ – — ―`) become `-`.
4. Soft hyphens (U+00AD) are removed.
5. Letters are lower-cased.

A map from each normalized character back to its original offset turns a normalized match into an original `[start, end)` range.


## 4. Finding a passage (`findPassage`)

Given a (possibly changed) text and a selector, the steps are tried in order; the first that succeeds wins:

| Step | Result `how` | Rule |
|---|---|---|
| 1 | `unchanged` | `text.slice(start, end) === exact`. |
| 2 | `exact` | Every occurrence of `exact` is a candidate. Each is scored by the length of the common suffix between its preceding text and `prefix`, plus the common prefix between its following text and `suffix`, minus a tiny penalty for distance from the old `start`. The best candidate wins. |
| 3 | `normalized` | The same, on normalized text, prefix and suffix (section 3). |
| 4 | `fuzzy` | Windows of the normalized text around occurrences of the passage's four longest words (longer than three letters) are compared with the normalized passage using the Dice coefficient on character bigrams, at the passage's length and at 90% and 110% of it. The best window wins if its score is at least the threshold (0.8 by default). |
| — | `null` | Not found. An empty `exact` is never found. |

Fuzzy matching exists for re-anchoring after a rescan or a new OCR pass; it never proves anything by itself (see sections 5 and 6).

## 5. Re-anchoring

When a source's extracted text changes (Replace with Better Copy, Relink with a different file, Recognize Text, Transcription used as text, Refresh from Document), every anchor with a non-empty `exact` is looked for in the new text with `findPassage`:

| Outcome | Effect |
|---|---|
| `unchanged`, `exact`, `normalized` | The anchor's position, `exact`, `prefix` and `suffix` are updated from the new text. |
| `fuzzy` | Updated the same way; reported as "found approximately — check it". |
| not found | The anchor is marked `broken`. |

The whole re-anchoring is one journaled, undoable step. Region and time anchors are kept as they are. Ties to the source become Stale (section 7) until confirmed again.

## 6. The verification gate (`verifyQuote`)

Every passage proposed by an AI service must pass the gate before it is shown:

1. A quote shorter than 3 normalized characters fails.
2. If the service gave a location (character offsets), the text at that location must equal the quote after normalization, or contain it.
3. Otherwise the quote is searched in the source (restricted to the named page when a page is given) with `findPassage`, **with fuzzy matching disabled**: only `exact` and `normalized` matches pass.

A proposal that fails is discarded and counted in AI History. The gate involves no model.

## 7. When a claim becomes Stale

A claim's status is Stale when any of these holds:

- its text in the linked document (`doc.start`–`doc.end`) differs from `doc.textAtCapture`;
- its text differs from `claimTextAtConfirm` recorded on a confirmed tie;
- an anchor of a confirmed tie is `broken`;
- a confirmed tie's `sourceHashAtConfirm` differs from the source's current `contentHash`.

Confirming the tie again records the current claim text and source hash, which clears the condition.

## 8. Test vectors

`tests/anchor-vectors.json` holds the examples (`text`, `selector`, `expect`). `expect` is `null` when the passage must not be found; otherwise it gives `how` and either the exact `start`/`end` or a substring the found range must `contain` (for fuzzy results). Add a vector for every behavior change.
