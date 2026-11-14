# Clean-room, trademark, privacy and licensing notes

This file records how Anne's Witness stays clear of other vendors' trademarks and copyrights, what it does and does not promise, and how it treats private information. It follows the practice of the other Anne's Office apps. It is not legal advice.

## Clean room

- Anne's Witness is not modeled on any one program. Its command set comes from long-standing professional practices (family-history evidence analysis, audit working papers, editorial fact-checking, textual scholarship, exhibit handling), described in the project's own words. See [ORIGINALITY.md](ORIGINALITY.md).
- No code, text, templates, sample data, icons, dialog layouts or help content are copied from any other program, including the programs named in ORIGINALITY.md as nearest relatives.
- File formats are implemented from public specifications (PDF, OOXML, ODF, GEDCOM, CSL, W3C Web Annotation, WARC, BibTeX, RIS) and through the sister apps' readers. Undocumented formats are not reverse engineered from leaked or decompiled code.
- No DRM is circumvented and no passwords are recovered. Protected files open only with their password.

## Generic terms

The interface uses ordinary descriptive words: source, anchor, claim, tie, case, status, reckoning, tick mark, exhibit, seal, proof summary. Where a trade or a vendor has its own branded or standard-specific term, the generic word is used:

| Avoided | Anne's Witness term |
|---|---|
| Names of professional standards and their numbered rules | "common practice", described in plain words in *Help ▸ Standards of Proof* |
| "Certified", "audited", "verified true" | Supported, Corroborated, Settled (statements about the evidence in the case, nothing more) |
| Content Credentials (as a product name) | "content credentials" only as the generic name of the open standard, and only for reading them |
| Assistant brand names | AI tab, AI menu |
| "Proof" as an app or feature name for review routing | not used; *Proof Summary* is a report |

## What the app does not promise

- **It does not establish truth.** A status describes how the claim is backed by the sources in the case. Sources can be wrong, forged or incomplete.
- **It is not professional advice or certification.** Templates for family-history proofs, financial tie-outs and fact checks describe common practice. Using them does not make work conform to any auditing, accounting, legal, genealogical or editorial standard, and the app says so in each template.
- **A sealed case shows that the file has not changed since it was sealed.** It does not show who sealed it or when, unless the user adds a signature or timestamp from a service of their choice.
- **AI output is labeled and is never evidence.** See [AI-PLAN.md](AI-PLAN.md).

## Private information and the rights of people in the sources

Evidence files often hold other people's information: family records, financial records, interviews.

- Everything stays on the device unless the user exports, sends or runs an AI command.
- Sources can be marked **confidential**; they are left out of exports, exhibits and all AI requests.
- *Redact for Sharing* removes confidential sources and details of living people from reports and bundles. The living-person rule follows the suite's GEDCOM privacy filter (Anne's Chart).
- Recordings and interviews: the user is responsible for having the consent that their law requires. *Add Interview or Recollection* has fields for who was present and whether consent to record was given.
- Capturing a web page saves a copy for the user's own evidence. Redistributing that copy in an exhibit bundle may need the publisher's permission; the bundle builder says so when web captures are included.
- Quoting from sources in reports is the user's responsibility under the copyright law that applies to them.

## Nominative use

The documentation names other products (Adobe Acrobat, Photoshop, Illustrator, InDesign, Premiere, After Effects, Lightroom, Firefly, Express, Bridge, FrameMaker, RoboHelp, Workfront, Content Authenticity and Adobe's other products; Microsoft Word, Excel and PowerPoint; Zotero, EndNote, Mendeley, Evidentia, Clooz, CaseWare, NVivo, ATLAS.ti, MAXQDA, CollateX, Juxta, CaseMap, Hypothes.is, NotebookLM and others) only to identify file formats, to say what Anne's Witness is *not*, or to let readers compare. This is nominative use; it implies no affiliation, sponsorship or endorsement. The names are trademarks of their respective owners; Adobe and the Adobe product names are trademarks of Adobe Inc., and Microsoft, Word, Excel and PowerPoint are trademarks of Microsoft Corporation.

## Third-party components (planned)

The final list will be generated from `package.json` into a third-party notices file at build time, as in the sister apps. Only permissive licenses are accepted in the base app (MIT, BSD, Apache 2.0, ISC, public domain, SIL OFL for fonts):

| Component | License |
|---|---|
| SQLite (WASM build, with FTS5) | public domain |
| pdf.js (page rendering, as in Anne's Folio) | Apache 2.0 |
| Tesseract.js (OCR, as in Anne's Folio) | Apache 2.0 |
| JSZip | MIT |
| citeproc-js or another CSL processor, if its license is compatible; otherwise a clean-room CSL processor | to be confirmed in M0 |
| CSL style files | each style's own license (most are CC BY-SA; styles are data loaded by the user, and a small permissively licensed set is bundled) |
| ONNX Runtime Web, Transformers.js | MIT, Apache 2.0 |
| Material Symbols | Apache 2.0 |
| Capacitor, Electron, electron-builder | MIT |
| On-device models | each model's own license, shown before download; permissive only |
| Public-domain shelf texts | public domain; source transcription named for each |

**Not used:** GPL or AGPL code; non-commercial-only model weights; copyrighted translations or editions in the built-in shelf.

## Online services

Anne's Witness works offline. Online services are called only when the user invokes the matching command: Capture Web Page and Link Check (the page's own site), the chosen AI services (AI tab), catalog lookups for citations (opt-in), model downloads, and update checks (desktop and APK builds, opt-in).
