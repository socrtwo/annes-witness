# Roadmap

> **Plan. There is no code yet.** Milestones are ordered by dependency, not by date. From M1 on, the release goal for each milestone is a tagged prerelease built for every platform with the CI and release workflows of the sister apps. Command ids refer to [COMMANDS-PLAN.md](COMMANDS-PLAN.md). A command is registered in the app only when it works.

## M0 — Planning (this repository)

- [x] Concept and survey: the Anne's Office apps and Adobe's apps reviewed, nearest relatives named ([ORIGINALITY.md](ORIGINALITY.md)).
- [x] Name, description, topics, keywords, app id and icon color ([AnnesWitness.meta.json](../AnnesWitness.meta.json), `package.json`).
- [x] README, command inventory ([COMMANDS-PLAN.md](COMMANDS-PLAN.md), generated from [commands-plan.src.txt](commands-plan.src.txt)), AI plan ([AI-PLAN.md](AI-PLAN.md)), architecture ([ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md)), formats ([FORMATS-PLAN.md](FORMATS-PLAN.md)), legal notes, license, contributing guide, issue templates, icon.
- [x] `scripts/gen-plan.py` validates ids, origin codes, shortcut conflicts, the required AI commands and the metadata file; planning-stage CI runs it on Linux and Windows.
- [ ] Re-check the Adobe lineup against Adobe's own product catalog. The survey in ORIGINALITY.md was written from product knowledge and news search results; the catalog pages could not be opened from the planning environment.
- [ ] Have each template's wording read by someone who does that work (a family historian, an accountant, an editor) and correct the vocabulary; confirm the app claims no conformance to any professional standard.
- [ ] Write the anchor selector and fingerprint specification in full (ARCHITECTURE-PLAN.md has the outline) with test vectors.
- [ ] Build a small openly licensed test corpus: made-up sources that disagree, a document that cites them, a rescanned copy of one source, a damaged case file.
- [ ] Confirm the license of every on-device model candidate in AI-PLAN.md and of every text proposed for the built-in public-domain shelf.

## M1 — Shell and the case file

- Project scaffold from the sister apps: TypeScript, Vite, vitest, Capacitor (Android, iOS), Electron, PWA manifest and service worker, CI and release workflows.
- Suite shell: command registry, ribbon with the 14 tabs, Quick Access Bar, classic menu bar (one menu per tab, including **AI**), Customize Ribbon and Keyboard, command search, Backstage, preferences.
- Case engine: the `.witness` container, the journal with undo and History (`edit.history`), Versions, autosave and restore, Open and Repair for the case itself.
- Sources, first formats: PDF (through the suite's PDF reader), images, plain text. Fingerprints, Source Details, groups, Check Fingerprints, Relink.
- Claims typed by hand (`claim.new`), details, groups, filter.
- Anchors on page regions and text runs; `tie.create`, the four tie kinds, Follow Tie, the Workbench view.
- Status rules computed from confirmed ties; Next Open Claim.
- A catalog test comparing the registry with `docs/commands-plan.json`.

**Done when:** a person can add three scanned pages, type five claims, tie them, see the statuses, close the app and find everything again.

## M2 — Linked documents and the checks

- Link Document for Anne's Pen and .docx, Anne's Grid and .xlsx, and PDF; Capture Claim from Selection, Capture All Numbers, Quotations, Dates and Names; Refresh from Document and the Stale status.
- Cell-range anchors in workbooks; `tie.sumOf`.
- Check tab: Quote, Number, Sum, Period, Unit, Date, Calendar, Age, Name, Citation, Staleness, Coverage; the Problems pane; Check on Save.
- Document View and Coverage View.
- Auto-Tie Exact Matches (proposals only) and the confirm and reject flow that the AI tab will reuse.

**Done when:** the figures of a sample annual report can be tied to its ledgers and every changed figure is caught on Refresh.

## M3 — Reading sources

- OCR through the suite engine; the Transcribe pane with marks for unclear, struck-out and supplied text; Compare Transcriptions.
- Capture Web Page (text, picture, time); recordings with time-range anchors; interviews and recollections; reference works; email messages.
- Replace with Better Copy and Re-Anchor Broken Ties; Find Duplicate Sources; Repair Source File through the sister apps' recovery engines.
- The public-domain shelf (`source.addLibraryText`) for checking quotations.

## M4 — Weighing evidence

- Classify Source, informant knowledge per anchor, Derived From, the Lineage view.
- Independence, Circular Citation and Weak Points checks; the Corroborated status.
- Resolve tab: Reckoning, Compare Anchors Side by Side, Collate Versions, Timeline of Sources, Prefer Source, Write Conclusion, Leave Unresolved, Reopen; the Settled status.
- Research Log, to-dos and search checklists; Tie as Absence.
- Apply Correction to Document as a tracked change or comment.

**Done when:** the guided example (three sources that disagree about a birth year) can be worked from Open to Settled with a written conclusion.

## M5 — Reports and exhibits

- Insert, update and remove notes in the linked document; tick marks and legend in the linked workbook; citation styles (CSL).
- Proof Summary, Claim Table, Source List, Open Items, Coverage Report, Research Log Report, Change Report.
- Exhibit Bundle through Anne's Folio; Number Exhibits; Redact for Sharing.
- Evidence Map through Anne's Chart; Matrix view.
- Seal Case and Verify Seal; Save Portable Case; Export Case as Text Folder.

## M6 — Review and the rest of the suite

- Comments, Prepared and Reviewed sign-offs, Review Queue, Second Reader Mode.
- Compare Cases, Merge Cases, Import Ties; New Period from This Case (roll-forward).
- Linked documents from Anne's Stage, Press, Loom, Base and Chart; GEDCOM citations in and out; Anne's Test reports as sources.
- Macros, Rules, the script editor, the command line check for build pipelines, Query Case.

## M7 — AI

- AI tab and AI menu: the suite's setup wizard, provider adapters, AI and Privacy (per case and per source), AI History, Stop AI, Several AIs.
- The verification gate first: no AI proposal is shown until the app has confirmed that the quoted passage is at the named spot ([AI-PLAN.md](AI-PLAN.md)). This is built and tested before any AI command.
- Find group (Extract Claims, Find Support, Find Contradictions, Suggest Where to Look, Check That Citations Exist), then Ask the Case, then Read, Check and Write.
- On-device embeddings for passage search, and on-device Screen for Private Information.

AI comes late on purpose: every AI command produces proposals for the confirm and reject flow built in M2, and the app must be complete and useful without it.

## M8 — Stretch goals

- A shared case over the suite relay for people working at the same time.
- Reading content credentials attached to a picture and showing them in Source Details (reading only; Anne's Witness does not sign media).
- More linked-document formats (ODF, Markdown, LaTeX, HTML) and more anchor types (map coordinates, 3D model views).
- Catalog lookups for Check That Citations Exist (library and DOI catalogs), opt-in.
- Templates contributed by people in each trade.

## Throughout

- **Sources are never written.** Every reader is tolerant, and anything that repairs a file writes a new file.
- **Every milestone ships tests** for the status rules it adds; the rules are the product.
- **Accessibility:** status is never shown by color alone; every pane works by keyboard and with a screen reader.
