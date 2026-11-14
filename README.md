# Anne's Witness

*Part of the Anne's Office suite: [Anne's Pen](https://github.com/socrtwo/annes-pen) (documents), [Anne's Grid](https://github.com/socrtwo/annes-grid) (spreadsheets), [Anne's Post](https://github.com/socrtwo/annes-post) (email), [Anne's Stage](https://github.com/socrtwo/annes-stage) (presentations), [Anne's Loom](https://github.com/socrtwo/annes-loom) (web sites), [Anne's Press](https://github.com/socrtwo/annes-press) (desktop publishing), [Anne's Folio](https://github.com/socrtwo/annes-folio) (PDF), [Anne's Lens](https://github.com/socrtwo/annes-lens) (pictures), [Anne's Base](https://github.com/socrtwo/annes-base) (databases), [Anne's Chart](https://github.com/socrtwo/annes-chart) (diagrams and family trees), [Anne's Test](https://github.com/socrtwo/annes-test) (web security) and **Anne's Witness** (evidence).*

**Show your work.** Anne's Witness is an original, open-source evidence workbench for Android, iOS, Windows, macOS, Linux, ChromeOS and the web. The other apps in the suite help you *make* things: a report, a workbook, a family tree, a book. Anne's Witness answers the question a reader asks afterward: **how do you know?**

You give it your work and the records behind it. It lists what your work claims (each statement, number, date, name and quotation), lets you tie each claim to the exact spot in a source that backs it or contradicts it, checks by itself that the words and numbers still agree, helps you settle the cases where sources disagree, and prints the proof. It shares the suite's goal, **no missing commands**: every feature is a command that can go on the Quick Access Bar, on your own tab, in the classic menu bar, on a keyboard shortcut or in a macro, and is found by command search. It has an **AI** tab and an **AI** menu, with one rule: the AI may point at evidence, but only a real passage in a real source counts, and only a person confirms it.

> **Status: planning. There is no code yet.** This repository holds the plan: the concept, the command inventory (257 commands on 14 tabs), the AI plan, the file and architecture plans, and the roadmap. Issues and discussion are welcome.

## Why this app exists

No app in the Anne's Office suite, and no Adobe app, does this job; [docs/ORIGINALITY.md](docs/ORIGINALITY.md) goes through both lineups one by one. The work itself is old and is done today by hand, in separate trades that do not share tools:

- A **family historian** weighs a census page against a baptism register that gives a different birth year.
- An **accountant** ties every figure in a financial statement back to a ledger or a bank statement and marks it with a tick.
- An **editor** checks every fact and quotation in a manuscript against its source before it goes to press.
- A **researcher** has to show which page of which paper supports each sentence.
- Someone cleaning up **OCR** has to confirm the recognized text against the picture of the page.
- Anyone using **AI** has to find out whether what it wrote is supported by anything at all.

These are the same task. Anne's Witness is one tool for it.

## The five things in a case

| Thing | What it is |
|---|---|
| **Source** | A record you hold: a PDF, a scan or photograph, a workbook, a saved web page, a recording, a family tree file, an interview. Sources are fingerprinted and never altered. |
| **Anchor** | An exact spot in a source: a region of a page, a run of text, a range of cells, a span of time in a recording. An anchor remembers the passage itself, so it can be found again if the file is rescanned or repaginated. |
| **Claim** | Something your work says: a statement, number, date, name, relationship or quotation. A claim remembers where it sits in your document, workbook, database or chart. |
| **Tie** | The connection between a claim and an anchor, and its kind: *supports*, *contradicts*, *mentions*, or *absence* (you looked where it should be and it was not there). |
| **Case** | The file that holds all of the above, plus the notes, checks, conclusions and history (`.witness`). |

Each claim has a status that the app can justify at any time: **Open** (nothing tied), **Supported**, **Corroborated** (two or more *independent* sources), **Disputed** (sources disagree), **Settled** (disputed, with a written conclusion), **Stale** (the claim or the source changed after it was tied) or **Set Aside** (an opinion or assumption, not meant to be proven).

## Features and plan

- **Capture claims from your work.** Link an Anne's Pen, Grid, Stage, Press, Loom, Base or Chart file, or a .docx, .xlsx, .pptx, .pdf or GEDCOM file. Capture one sentence, or all numbers, all quotations, all dates and names at once. When the document changes, the affected claims turn Stale instead of silently staying "proven".
- **Tie to the exact spot.** Draw a box on a scanned page, select text, select cells, or mark seconds in a recording. One keystroke ties it to the active claim. *Follow Tie* jumps both ways.
- **Checks the app computes itself, with no AI.** Quote Check (letter for letter, with marked omissions allowed), Number Check, Sum Check (totals down and across), Date and Calendar Checks (Julian and Gregorian, dual dating), Independence Check (two copies of the same original count once), Circular Citation Check, Staleness Check, Coverage (what in the document has no backing) and Weak Points.
- **Reckonings.** When sources disagree, lay them side by side: what each says, who said it, how they knew, when it was written, original or copy. Record which you accept and why. A Disputed claim cannot become Settled without a written conclusion.
- **Source lineage.** Record that one source was copied, indexed, abstracted or translated from another. The app draws the lines of descent and uses them when it counts independent sources.
- **Reports a reader can check.** Footnotes or endnotes written into the linked document, tick marks and a legend written into a workbook, a Proof Summary, a Claim Table, an Open Items list, an Evidence Map (through Anne's Chart) and an **Exhibit Bundle** (through Anne's Folio): each anchored page with its region outlined, numbered and indexed to the claims.
- **Sealed cases.** A read-only copy with a hash of every source and every tie, so a reader can verify that nothing changed afterward.
- **Review by a second person.** Prepared and Reviewed sign-offs that clear themselves if the evidence changes, and a Second Reader Mode that hides the first person's ties so the reviewer finds the support independently.
- **AI tab and AI menu** with 32 commands: Ask the Case (answers only from your sources, each sentence with its anchors), Extract Claims, Find Support, Find Contradictions, Check That Citations Exist, Transcribe, Translate, Extract Fields from Record, Draft Proof Summary and the suite's provider setup, privacy settings, history and several-AIs modes. AI results are proposals; the app itself verifies that each proposed passage really is at the spot named before showing it. See [docs/AI-PLAN.md](docs/AI-PLAN.md).
- **Damaged files.** A damaged source goes to the suite recovery engine of its type; a damaged case is rebuilt from its journal. Broken anchors are re-found by their text. See [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md).
- **Private by default.** Everything works offline. Sources can be marked confidential, which keeps them out of exports, exhibits and every AI request. Details of living people can be removed from anything you share.

The full inventory is in [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md).

## What it is not

- Not a word processor, spreadsheet, database, PDF editor or diagram editor; it opens those files to read and point at them, and hands editing back to the app that owns them.
- Not a reference manager only. It keeps citations, but its subject is whether the cited passage supports the sentence.
- Not a content-credentials tool. It does not sign media to say who made it; it records which passage of which record supports which statement.
- Not an oracle. It never states that a claim is *true*. It shows what the sources say and how well a claim is backed.
- Not legal, accounting or audit advice. The templates describe common practices; they do not certify compliance with any professional standard. See [docs/LEGAL.md](docs/LEGAL.md).

## Platforms (planned)

As for the sister apps, each release will have builds for **Android** (APK and AAB), **iOS/iPadOS** (an unsigned .ipa you sign with your Apple ID), **Windows** (installer or portable), **macOS** (universal), **Linux** (AppImage or .deb for x64, arm64 and armv7l, which covers Raspberry Pi OS), **ChromeOS** and the **web** (static files; offline-capable and installable). See [docs/ROADMAP.md](docs/ROADMAP.md).

## The Anne's Office suite

| App | What it is | What Anne's Witness does with it |
|---|---|---|
| [Anne's Pen](https://github.com/socrtwo/annes-pen) | Word processor | Captures claims from documents; writes footnotes and endnotes back |
| [Anne's Grid](https://github.com/socrtwo/annes-grid) | Spreadsheet | Captures figures; anchors cell ranges; writes tick marks and a legend back; receives claim tables |
| [Anne's Post](https://github.com/socrtwo/annes-post) | Email | Messages as sources; sends cases and reports |
| [Anne's Stage](https://github.com/socrtwo/annes-stage) | Presentations | Captures claims from slides and speaker notes |
| [Anne's Loom](https://github.com/socrtwo/annes-loom) | Web sites | Captures claims from pages; saved web captures as sources |
| [Anne's Press](https://github.com/socrtwo/annes-press) | Desktop publishing | Captures claims from layouts before they go to print |
| [Anne's Folio](https://github.com/socrtwo/annes-folio) | PDF | PDF sources and OCR; builds the Exhibit Bundle |
| [Anne's Lens](https://github.com/socrtwo/annes-lens) | Pictures | Scans and photographs as sources |
| [Anne's Base](https://github.com/socrtwo/annes-base) | Databases | Captures record fields as claims; receives case data |
| [Anne's Chart](https://github.com/socrtwo/annes-chart) | Diagrams, family trees | Captures persons and relationships from GEDCOM; draws the Evidence Map |
| [Anne's Test](https://github.com/socrtwo/annes-test) | Web security | Scan findings and fix records as sources for a report |
| **Anne's Witness** | Evidence (this project) | https://github.com/socrtwo/annes-witness |

## Documentation

| File | Contents |
|---|---|
| [docs/ORIGINALITY.md](docs/ORIGINALITY.md) | The survey of the Anne's Office apps and Adobe's apps, why this is not a copy of any of them, its nearest relatives elsewhere, and where its ideas come from |
| [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md) | The planned command inventory, tab by tab, with ids, shortcuts and origins (generated) |
| [docs/commands-plan.json](docs/commands-plan.json) | The same data as JSON, for the future catalog test (generated) |
| [docs/AI-PLAN.md](docs/AI-PLAN.md) | The AI tab and AI menu: what each command does and sends, the rules, privacy |
| [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) | The case file, anchors and fingerprints, the status rules, the journal, repair |
| [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md) | What can be a source, what can be a linked document, what is exported |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones |
| [docs/LEGAL.md](docs/LEGAL.md) | Clean-room, trademark, privacy and licensing notes |
| [AnnesWitness.meta.json](AnnesWitness.meta.json) | Repository description, topics, keywords, app id and icon color |

The command plan is generated: edit [docs/commands-plan.src.txt](docs/commands-plan.src.txt) and run `python3 scripts/gen-plan.py` (it also checks ids, origins, shortcut conflicts and the metadata file). It needs only Python 3.10 or later.

## Project language

The interface, code comments and documentation use American English.

## License

[MIT](LICENSE). Copyright (c) 2026 Paul D Pruitt.

## Legal

Anne's Witness is an independent, clean-room project released under the MIT License. It is not affiliated with, endorsed by, or sponsored by Adobe, Microsoft, the makers of any other program named in this repository, any professional standards body, or any AI provider. Product names appear only to describe file-format compatibility or to say what Anne's Witness is not (nominative use); they are trademarks of their owners. The interface, icons, templates, sample cases and text will be original or openly licensed. See [docs/LEGAL.md](docs/LEGAL.md).
