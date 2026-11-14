# Architecture plan

> **Plan. There is no code yet.** This is the intended design. It follows the sister apps wherever the job is the same (shell, platform layer, AI providers, recovery) and describes in detail only what is particular to Anne's Witness.

## Layers

| Layer | Contents | Shared with the suite? |
|---|---|---|
| Shell | Command registry, ribbon, classic menu bar, Quick Access Bar, command search, customization, Backstage, macros | Yes |
| Platform | TypeScript, Vite, Capacitor (Android, iOS), Electron (desktop), PWA; file access; keychain | Yes |
| Readers | One read-only reader per source or document format, each producing pages, text runs, cells or time ranges with stable addresses | Reuses the suite's PDF, document, workbook, picture and GEDCOM readers |
| Case engine | Case store, journal, anchors and fingerprints, status rules, checks | New |
| Views | Workbench, Document, Source, Matrix, Coverage, Lineage, Timeline | New |
| Reports | Notes into documents, tick marks into workbooks, summaries, exhibit bundle, seal | New, writing through Anne's Pen, Grid, Folio and Chart |
| AI | Provider adapters, setup wizard, ensemble, history; the verification gate | Adapters shared; the gate is new |

Everything runs on the device. There is no server component; the optional suite relay (shared cases) is a stretch goal.

## The case file (`.witness`)

A ZIP container, so a case can be inspected and repaired with ordinary tools:

```
case.sqlite          sources, anchors, claims, ties, notes, conclusions, checks, sign-offs
journal/             append-only change log, one small file per session
sources/             copies of source files (always for web captures and clipboard items;
                     for other files only in a portable case)
derived/             OCR text, transcriptions, thumbnails; can be rebuilt
manifest.json        format version, hash list, seal (if sealed)
```

A case normally *references* source files where they are and stores each one's fingerprint. *Save Portable Case* copies them in.

## Data model

| Record | Key fields |
|---|---|
| **Source** | id, title, kind, citation fields, date made, classification (original, derivative, authored), derived-from links, confidential flag, file reference, file hash, content hash |
| **Anchor** | id, source id, selector (below), the passage itself (text, number or image hash), neighborhood, informant and knowledge (first-hand, second-hand, unknown) |
| **Claim** | id, text, kind, document reference and position, text at the time of capture, depends-on links, status, owner |
| **Tie** | id, claim id, anchor id (or another claim), kind (supports, contradicts, mentions, absence, sum-of), direct or indirect, tick mark, state (proposed or confirmed), proposed by (person, Auto-Tie, AI and which service), confirmed by, confirmed at |
| **Reckoning** | claim id, the table of sources compared, preferred reading, written conclusion, author, date |
| **Log entry** | search made, where, for what, result |

## Anchors: selectors and fingerprints

An anchor must still point at the right passage after the source file is moved, renamed, rescanned or re-exported. Each anchor therefore stores several selectors and the passage itself:

| Source type | Position selector | Content selector |
|---|---|---|
| PDF, scan, picture | page number and rectangle, as fractions of the page | the recognized or transcribed text inside the rectangle, with text before and after; a perceptual hash of the region's picture |
| Text, web capture, document | character range | the exact text, with text before and after |
| Workbook, table | sheet and cell range | the cell values, with row and column headings |
| Recording | start and end time | the transcript words in that span, if any |
| Family tree file, database | record id and field | the field value |

The design follows the general idea of the W3C Web Annotation selectors (position, quotation with prefix and suffix), extended to regions, cells and time. It is implemented from the public specification.

**Source fingerprints.** Two hashes per source: a hash of the file's bytes, and a hash of its extracted content (text and page pictures). A file that was only renamed or re-saved without change matches on one or both and is relinked automatically. A file whose content changed is reported by *Check Fingerprints*, and its anchors go through re-anchoring.

**Re-anchoring.** For each anchor of a changed source: look for the exact passage; if it is found once, move the anchor; if it is found several times, use the neighborhood to choose; if only a near match is found, propose it; if nothing is found, mark the anchor broken. Every moved or proposed anchor is listed for review, and the ties that depend on it are Stale until the review is done.

## Status rules

Status is computed, not typed. The rules are small and will be covered by tests before any interface is built, because they are the product.

| Status | Rule |
|---|---|
| Open | No confirmed tie |
| Supported | At least one confirmed *supports* tie, no confirmed *contradicts* tie, all checks on those ties pass |
| Corroborated | Supported by two or more sources that are independent (no common ancestor in the derived-from graph, and neither derived from the other) |
| Disputed | At least one confirmed *supports* and at least one confirmed *contradicts* tie |
| Settled | Disputed, with a Reckoning that has a preferred reading and a written conclusion |
| Stale | The claim's text in its document, or the content of a tied source, differs from what was recorded when a tie was confirmed |
| Set Aside | Marked by a person as opinion or assumption, with a reason |

Further rules: a claim that depends on other claims cannot have a stronger status than the weakest of them; a *mentions* tie never changes status; a proposed tie never changes status; an *absence* tie counts as support for a negative claim and as a contradiction for a positive one only when the person says so in Tie Details.

A person can set Set Aside, and can move a claim back to Open. A person cannot set Supported, Corroborated or Settled directly; they follow from the ties.

## Journal and history

Every change to the case is one journal entry: who, when, what, before and after. Undo, History, Claim History, Versions, Compare Cases, the Change Report and the Reviewed sign-off (which clears when later entries touch the claim) are all views of the journal.

## Linked documents

A linked document is opened read-only by its reader. A claim's position is stored as an address the owning app understands (paragraph and character range, sheet and cell, slide and shape, record and field, person id) plus the claim's text. *Refresh from Document* re-reads the file and matches claims by address and text, in the same way as re-anchoring.

Writing back (notes, tick marks, tracked changes, comments) goes through the owning format's writer and always produces changes the owning app shows as such. If a document is open in its app at the same time, the hand-off uses the suite's inter-app messages; otherwise the file is written and the journal records it.

## Checks

Each check is a pure function from case data to a list of findings (claim or tie, severity, message, suggested command). Checks do not use AI and do not change the case. *Rules* (`tools.rules`) are user-defined checks in the same form. The command line mode runs all checks and exits with a result code, so a case can guard a publishing pipeline.

## Repair

- **A damaged source** is handed to the recovery engine of the sister app for its type. The repaired copy is added as a new, derivative source; the damaged original stays.
- **A damaged case:** the ZIP is salvaged entry by entry (the suite's ZIP salvage); if `case.sqlite` is unreadable it is rebuilt by replaying `journal/`; `derived/` is regenerated. *Open and Repair* writes a new file and a repair report.
- **A sealed case** that fails *Verify Seal* is opened read-only with the differences listed.

## The AI verification gate

One function, used by every AI command that proposes a tie or a claim: given (source id, selector, quoted words), read that location through the same reader the interface uses and compare, as text or as numbers. It has no model in it. Proposals that fail never reach the interface. See [AI-PLAN.md](AI-PLAN.md).

## Accessibility and languages

Status is shown by a pattern and a word as well as a color. All panes work by keyboard and expose their structure to screen readers. Source text may be in any script and direction; the transcription pane supports right-to-left and vertical text. The interface is written in American English first, with the suite's translation mechanism.
