# Roadmap

> **Version 0.2.0.** Milestones are ordered by dependency, not by date. Checked items are implemented and covered by tests; unchecked items are not done. Command ids refer to [COMMANDS-PLAN.md](COMMANDS-PLAN.md); [COMMANDS.md](COMMANDS.md) lists which commands are implemented (all 308).

## M0 — Planning

- [x] Concept and survey: the Anne's Office apps and Adobe's apps reviewed, nearest relatives named ([ORIGINALITY.md](ORIGINALITY.md)).
- [x] Name, description, topics, keywords, app id and icon color ([AnnesWitness.meta.json](../AnnesWitness.meta.json), `package.json`).
- [x] README, command inventory, AI plan, architecture, formats, legal notes, license, contributing guide, issue templates, icon.
- [x] `scripts/gen-plan.py` validates ids, origin codes, shortcut conflicts, the required AI commands and the metadata file; CI runs it on Linux and Windows.
- [x] Adobe lineup checked against Wikipedia's *List of Adobe software* (14 November 2026): no product there has evidence or claim verification as its purpose.
- [x] Commands gathered from comparable tools (reference managers, family-history evidence tools, audit tie-out, editorial fact-checking, qualitative research, collation, open-source investigation, annotation, citation-context tools) and new ideas added to the plan: 257 → 307 commands.
- [ ] Read Adobe's own product catalog by hand for anything newer than the Wikipedia list. The catalog page refuses automated clients.
- [ ] Have each template's wording read by someone who does that work (a family historian, an accountant, an editor).
- [x] Anchor selector specification with test vectors ([ANCHORS.md](ANCHORS.md), `tests/anchor-vectors.json`); writing it found and fixed an offset error after soft hyphens.
- [ ] Build a larger openly licensed test corpus; today the corpus is the guided example and fixtures built inside the tests.

## M1 — Shell and the case file

- [x] TypeScript, Vite, vitest; PWA manifest and service worker (offline after first load).
- [x] Electron desktop shell and electron-builder configuration; Capacitor configuration. See [BUILD.md](BUILD.md).
- [x] Release workflows for Android, iOS, Windows, macOS and Linux, adapted from the sister apps (`release.yml`, `android.yml`). **Written and statically checked, not yet run on GitHub.**
- [x] Android and iOS projects generated with Capacitor; Electron desktop API (dialogs, recent and pinned cases, Show in Folder, open with the system app, web capture, new windows). **Not compiled here:** the build environment cannot download the Android SDK or the Electron binary.
- [x] Suite shell: command registry driven by the plan, ribbon with 14 tabs, classic menu bar (one menu per tab, including **AI**), Quick Access Bar with Add All Choices, your own ribbon tab, keyboard customization, command search (Alt+Q), File backstage, options, themes.
- [x] Case engine: `.witness` container, journal with undo and redo, History with restore, named Versions, autosave to the browser and restore, Open and Repair (ZIP salvage and journal replay), password protection.
- [x] Sources: PDF (pages drawn with pdf.js), images, text; fingerprints, Source Details, groups, Check Fingerprints, Relink.
- [x] Claims, anchors on text runs and page regions, the six tie kinds, Follow Tie, the Workbench view.
- [x] Status rules computed from confirmed ties (Open, Supported, Corroborated, Disputed, Settled, Stale, Set Aside); dependencies cap a conclusion.
- [x] Catalog test comparing registered commands with `docs/commands-plan.json`.

## M2 — Linked documents and the checks

- [x] Link Document for .docx, .xlsx, .pptx, OpenDocument, PDF, HTML and text; Capture Claim from Selection; Capture All Numbers, Quotations, Dates and Names; Refresh from Document with Stale detection.
- [x] Cell anchors in workbooks (each cell is a labeled text segment); Tie Total to Parts.
- [x] 24 checks: Quote, Paraphrase, Name, Citation, Number, Sum, Period, Unit, Date, Calendar (Julian/Gregorian, dual dating), Age, Independence, Circular, Staleness, Coverage, Links, Weak Points, Rules, Number Consistency, Self-Contradiction, Precision, Hedging, Recency, Materiality; Problems pane; Check on Save.
- [x] Document View and Coverage View.
- [x] Auto-Tie Exact Matches and Match Column to Sources (proposals only), with the confirm and reject flow.
- [ ] Linked documents in the native formats of Anne's Pen, Stage, Press, Loom, Base and Chart (their Office/ODF/HTML exports work today).

## M3 — Reading sources

- [x] OCR through Tesseract.js (pictures and PDF pages); Transcribe pane with transcription marks and status; Compare Transcriptions.
- [x] Capture Web Page (works where the site allows cross-site fetching; otherwise add a saved page); recordings with VTT/SRT transcripts (time-range segments); interviews and recollections; reference works; e-mail (.eml, .mbox); EPUB; GEDCOM.
- [x] Replace with Better Copy and Re-Anchor; Find Duplicate Sources; picture metadata; page reading tools.
- [x] Repair Source File: ZIP and XML salvage for Office/ODF/EPUB, PDF stream text recovery, tolerant legacy readers; the repaired text becomes a new derivative source (ported from Anne's Pen and Anne's Grid).
- [x] Public-domain shelf: Project Gutenberg plain-text editions fetched on request, with the edition confirmed from the file's own title.
- [x] Word 97–2003 (.doc), Excel 97–2003 (.xls) and Outlook .msg, with readers ported from Anne's Pen and Anne's Grid.

## M4 — Weighing evidence

- [x] Classify Source, informant knowledge per anchor, Derived From, Lineage view.
- [x] Independence, Circular Citation and Weak Points checks; the Corroborated status.
- [x] Reckonings: side by side, Collate Versions with a variant apparatus, Variant Heat Map, Timeline of Sources, preferred reading, written conclusion, Leave Unresolved, Reopen; the Settled status.
- [x] Research Log, Correspondence Log, to-dos and search checklists; Tie as Absence.
- [x] Apply Correction to Document as a .docx comment.

## M5 — Reports and exhibits

- [x] Notes written into .docx (footnotes, endnotes or comments, placed at the end of each claim's paragraph); Update and Remove Notes; tick sheet and legend added to .xlsx; Snip Value to Cell.
- [x] Proof Summary, Claim Table, Source List (Markdown, BibTeX, RIS, CSL-JSON), Open Items, Coverage Report, Research Log, Change Report, Chronology, Citation Context, Hash Report, Confidential Sources Log, ClaimReview markup, Reader Verification Kit.
- [x] Exhibit Bundle PDF with index, marked regions and Bates numbering; Redact for Sharing.
- [x] Evidence Map (SVG) and Matrix view.
- [x] Seal Case and Verify Seal; Save Portable Case; Export Case as Text Folder and Open Text Folder.
- [x] CSL style files (a practical subset of CSL 1.0.2: no sorting or disambiguation) beside the two built-in styles.
- [ ] Evidence Map in Anne's Chart's own format.

## M6 — Review and the rest of the suite

- [x] Comments, Prepared and Reviewed sign-offs (a review is flagged when the claim changes afterward), Review Queue, Second Reader Mode, Reviewer Agreement (Cohen's kappa), Sample Claims for Review.
- [x] Compare Cases, Merge Cases, Import Ties; New Period from This Case.
- [x] GEDCOM citations read into sources, claims and proposed ties.
- [x] Macros (record and run), Rules, Script Editor, Query Case (read-only SQL), command-line checks (`npm run witness`).
- [x] Export Citations as GEDCOM (5.5.1).
- [x] Open in App opens the linked document or a source with the system's program (desktop) or downloads it (web).
- [ ] Jumping to the exact sentence or cell inside the sister apps.

## M7 — AI

- [x] AI tab and AI menu: AI Setup wizard (Claude recommended; local and other OpenAI-compatible servers), keys kept per session or encrypted with a passphrase, AI and Privacy levels, AI History, Stop AI, Several AIs (each AI's proposals checked separately).
- [x] The verification gate (`src/ai/gate.ts`): no proposal is shown unless the app finds the cited words in the source. Built and tested before the AI commands.
- [x] **Source Attribution Wizard** (`ai.attributionWizard`): facts per sentence → Claude citations → gate → proposed ties → **Verify Drafts**.
- [x] Find group (Extract Claims, Find Support, Find Contradictions, Suggest Where to Look, Check That Citations Exist with catalog lookup), Ask the Case, Read, Check and Write groups.
- [x] On-device passage selection (BM25, no model download): the wizard, Ask and Find work under **Passages only** and send only the best passages.
- [ ] Neural embeddings or a small local model.
- [x] Several AIs: union of independently checked proposals, or agreement mode (kept only when most AIs proposed it). Rounds of deliberation are not planned: every proposal must be checked against a source on its own.
- [x] Opt-in live test (`tests/live.test.ts`), run by CI when an `ANTHROPIC_API_KEY` secret is set. **Not yet run:** no key was available while building.

## M8 — Stretch goals

- [x] Catalog lookups (Crossref, Open Library, PubMed) for Add by Identifier, Retrieve Citation Details, Check That Citations Exist and Retraction Check, opt-in.
- [ ] A shared case over the suite relay.
- [ ] Reading content credentials attached to a picture.
- [ ] More linked-document formats (Markdown, LaTeX) and anchor types (map coordinates).
- [x] Spelling (English: US, UK, Canada, Australia) and a case language for spelling and OCR.
- [ ] Interface languages other than English.

## Throughout

- **Sources are never written.** Readers are tolerant; repairs write new files.
- **Status rules are tested** (`tests/core.test.ts`), as are the gate and the wizard (`tests/ai.test.ts`).
- **Accessibility:** status is shown by word and pattern as well as color; panes work by keyboard; an automated axe-core audit runs in the browser test with no serious or critical findings. A manual screen-reader test is still to do.
