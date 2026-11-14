# Originality survey

> **Plan. There is no code yet.** This file records the review that was done before Anne's Witness was named: every app in the Anne's Office suite, and Adobe's apps, each checked against one question — *is its main job to connect what a piece of work says to the evidence for it?* It also names the nearest relatives outside those two lineups, so the claim of originality is stated no more strongly than the review supports.

## What is claimed, and what is not

- **Claimed:** Anne's Witness is not a clone, port or rehash of any Anne's Office app or of any Adobe app. None of them has evidence as its subject.
- **Not claimed:** that nothing like any part of it exists anywhere. Each trade that does this work has its own tools for its own slice (listed in section 3). What was not found is one general tool that joins those slices. No exhaustive market search was done.
- **How the review was done:** the eleven suite repositories were read directly. The Adobe lineup was written from product knowledge and from news search results in November 2026; Adobe's own catalog pages could not be opened from the planning environment, so that list should be re-checked (it is an open item in [ROADMAP.md](ROADMAP.md), M0).

## 1. The Anne's Office suite

| App | Its job | Nearest feature to Anne's Witness | Why it is a different job |
|---|---|---|---|
| Anne's Pen | Write documents | References tab (citations, bibliography), Compare | Inserts and formats citations; does not record which passage supports which sentence, or test that it does |
| Anne's Grid | Spreadsheets | Trace precedents, workbook analysis | Traces formulas inside the workbook; does not tie a figure to an outside record |
| Anne's Post | Email, calendar, contacts | — | Messages can be sources; nothing more |
| Anne's Stage | Presentations | — | Slides can hold claims; nothing more |
| Anne's Loom | Web sites | Site reports | Reports on the site's files and pages, not on whether what the pages say is backed by evidence |
| Anne's Press | Desktop publishing | — (its repository holds only an early plan) | Lays out pages for print; layouts can hold claims |
| Anne's Folio | PDF | Comments, links, compare, redaction, Bates numbering | Marks up one PDF; the Exhibit Bundle will use it as the writer |
| Anne's Lens | Pictures | Metadata, OCR hand-off | Views and converts pictures; scans become sources |
| Anne's Base | Databases | Record history, data lineage | Lineage of data rows inside a database, not of statements in a written work |
| Anne's Chart | Diagrams, org charts, family trees | Source citations on GEDCOM persons | Draws the tree; does not weigh conflicting records. Will draw the Evidence Map |
| Anne's Test | Web security testing | Findings with evidence | Tests a web site; its reports can be sources |

Anne's Witness sits across the suite; it does not replace any part of it. It reads the other apps' files to point at them, and writes back only notes, tick marks, comments and tracked changes through the owning app.

## 2. Adobe's apps

Grouped by job. None has evidence for written claims as its subject.

| Group | Apps | Job |
|---|---|---|
| Photographs and painting | Photoshop, Lightroom, Lightroom Classic, Photoshop Elements, Fresco | Edit, organize and paint pictures |
| Drawing and layout | Illustrator, InDesign, InCopy, Express | Vector art, page layout, editorial copy, quick designs |
| Video and motion | Premiere, Premiere Elements, After Effects, Media Encoder, Character Animator, Animate, Frame.io | Edit, composite, encode, animate and review video |
| Sound | Audition, Podcast | Record and edit audio |
| 3D | Substance 3D Painter, Designer, Sampler, Stager and Modeler; Dimension; Project Neo; Mixamo | Model, texture and render 3D |
| Generative AI | Firefly (with Boards and, as reported at MAX 2026, Firefly Builder, Firefly Graph and the Firefly AI Assistant) | Generate and edit images, video, audio, designs and prototypes; automate creative workflows |
| Documents | Acrobat Reader, Standard, Pro and Studio; Acrobat Sign; Scan; Fill & Sign; Digital Editions | View, edit, sign, scan and read PDFs and e-books |
| Web and interface design | Dreamweaver, XD | Build web pages; design interfaces |
| Assets and services | Bridge, Fonts, Stock, Color, Capture, Behance, Portfolio | Browse files, license fonts and stock, pick colors, show work |
| Technical and learning | FrameMaker, RoboHelp, Captivate, Connect, ColdFusion | Technical manuals, help systems, e-learning, web meetings, an application server |
| Provenance of media | Content Authenticity (and Content Authenticity for Enterprise) | Attach signed content credentials to a creative file saying who made it and how |
| Marketing and enterprise | Experience Manager, Analytics, Target, Campaign, Marketo Engage, Journey Optimizer, Real-Time CDP, Commerce, Advertising, Workfront, GenStudio | Web content management, analytics, marketing automation, commerce, work management |
| Retired or winding down | PageMaker, FreeHand, Fireworks, Flash Professional, Director, Authorware, GoLive, Muse, Contribute, Encore, Soundbooth, Prelude, SpeedGrade, Story, Spark, Premiere Rush, Aero, Comp, Photoshop Mix, Fix, Sketch and Camera, Illustrator Draw, the Edge tools, PhoneGap, Flash Builder | Earlier layout, drawing, web, multimedia authoring, video and mobile tools |

### The closest Adobe features, and how they differ

| Adobe feature | What it does | Difference |
|---|---|---|
| Acrobat **Compare Files** | Shows the differences between two versions of a PDF | Two versions of one document. Anne's Witness relates a statement in one work to a passage in a different record, across any number of records |
| Acrobat **AI Assistant** and Acrobat Studio's PDF Spaces | Answer questions about PDFs you supply, with links to the passages used | The assistant writes an answer and attributes it. Anne's Witness starts from *your* work, keeps a lasting record of support for each claim, verifies proposed passages without a model, tracks conflicts, staleness and independence, and works with no AI at all |
| **Content Authenticity** | Records who made a media file and what tools touched it | Provenance of a *file*. Anne's Witness records the evidence for a *statement*. The two are complementary; reading content credentials as a property of a source is a stretch goal |
| **Workfront** proofing | Routes a draft to reviewers for comments and approval | Review and approval of how a piece looks and reads. The name "Proof" was avoided for this app because of it |
| **Bridge** metadata | Describes and finds asset files | Describes files, not the relation between files and claims |
| **FrameMaker**, **RoboHelp**, **InCopy** | Author structured and editorial text, with cross-references | Authoring tools; cross-references point within the document set |

## 3. Nearest relatives elsewhere

These are named so that readers can judge the overlap themselves. Each does part of the job for one trade. Anne's Witness borrows no code, text or interface from any of them.

| Kind of tool | Examples (nominative use) | The slice it covers | What Anne's Witness adds |
|---|---|---|---|
| Reference managers | Zotero, EndNote, Mendeley | Citation records, styles, PDF notes | Ties at the level of sentence and passage; checks; conflicts; statuses |
| Family-history evidence tools | Evidentia, Clooz | Source, information and evidence analysis for genealogy | The same analysis for any subject; ties into the working document; number and quote checks |
| Audit working-paper software | CaseWare, and the tie-out features of disclosure tools | Tick marks, cross-references, sign-offs, roll-forward | Works on any file without a firm's system; sources that are scans; conflict resolution |
| Qualitative research tools | NVivo, ATLAS.ti, MAXQDA | Coding passages of sources; matrices | Starts from claims in a finished work, not from themes in the sources |
| Collation tools | CollateX, Juxta | Aligning versions of one text | Collation is one command in Resolve, used when sources are versions of each other |
| Case-analysis tools for lawyers | CaseMap | Facts linked to documents for litigation | Not built around litigation; checks; suite documents |
| Web annotation | Hypothes.is | Notes anchored to passages of web pages | Anchors serve claims and statuses; all file types; offline |
| AI research assistants with citations | NotebookLM and similar | Generated answers attributed to uploaded sources | See the Acrobat AI Assistant row above |

## 4. What is new in the combination

1. **One model for five trades:** source, anchor, claim, tie, case — the same for a census page, a ledger, a manuscript and an OCR result.
2. **Status that the app can justify and that decays.** A claim is Supported only while confirmed ties justify it, and turns Stale by itself when the document or the source changes.
3. **Independence is computed.** Two sources that descend from one original count once, from recorded lines of descent.
4. **Absence is evidence.** A recorded search that found nothing can be tied to a claim.
5. **Checks without AI** for quotations, figures, sums, dates and calendars, run over ties.
6. **A verification gate for AI:** a model's proposal is shown only if the app finds the quoted words at the named spot ([AI-PLAN.md](AI-PLAN.md)).
7. **Second Reader Mode:** a reviewer finds the support blind, then the two sets of ties are compared.
8. **Anchors that survive a rescan,** re-found by the passage they hold.
9. **Sealed cases and exhibit bundles** built from the same ties.

## 5. Where the ideas come from

The practices are older than software, and the vocabulary is generic.

- **The rule of more than one witness.** Requiring corroboration before a matter is accepted is ancient in law. Deuteronomy 19:15 (KJV): "at the mouth of two witnesses, or at the mouth of three witnesses, shall the matter be established." The app's Corroborated status and its name come from this tradition; the app adds the condition that the witnesses be independent.
- **Family-history evidence analysis:** distinguishing original from derivative records, first-hand from second-hand information, and direct from indirect or negative evidence; resolving conflicts in writing.
- **Audit working papers:** tying figures to supporting records, tick marks with a legend, footing and cross-footing, prepared-by and reviewed-by sign-offs, carrying work forward to the next period.
- **Editorial fact-checking:** checking copy line by line against sources before publication.
- **Textual scholarship:** transcription conventions, collation of versions, and reasoning about which copy descends from which.
- **Exhibit practice:** numbered exhibits, sealed copies and redaction.
