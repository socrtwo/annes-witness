# Formats plan

> **Implemented in 0.1.0 except where the Milestone column says otherwise** (still open: the native file formats of the sister apps; their Office, ODF and HTML exports work). Anne's Witness reads many formats and edits none of them. A file is either a **source** (evidence), a **linked document** (the work being checked), or both. Readers come from the sister apps wherever one exists. Formats are recognized by content, not by extension.

## The case

| Format | Use |
|---|---|
| `.witness` | The case: a ZIP container with the case data (JSON), a journal, derived text and, in a portable case, copies of the sources. See [ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md). |
| `.witness` (sealed) | The same container, read-only, with a hash list of every source and tie in its manifest |
| Text folder | The case as JSON and Markdown files, for version control (`dev.exportText`); can be imported back |

The extension is provisional until M1.

## Sources

| Kind | Formats | Anchor type | Reader | Milestone |
|---|---|---|---|---|
| PDF | .pdf, including scanned and damaged files | page region, text run | Anne's Folio engine | M1 |
| Pictures | JPEG, PNG, TIFF (multi-page), WebP, HEIC, GIF, BMP | region | Anne's Lens readers | M1 |
| Plain text | .txt, .md, .csv, .tsv, .json, .xml | character range, row and field | built in | M1 |
| Documents | Anne's Pen (via .docx export), .docx, .doc (Word 97–2003), .odt | text run | Anne's Pen readers | M2 |
| Workbooks | Anne's Grid (via .xlsx export), .xlsx, .xls (Excel 97–2003), .ods | cell range | Anne's Grid readers | M2 |
| Web captures | a saved page: text, full-page picture, address and time; also .mhtml, .html, WARC (read) | text run, region | built in | M3 |
| Recordings | MP3, M4A, WAV, OGG, MP4, WebM, with optional transcript (.vtt, .srt) | time range | platform media | M3 |
| Email | .eml, .msg (Outlook: subject, sender, plain body), .mbox | text run | Anne's Post readers | M3 |
| Interview or recollection | typed in the app | text run | built in | M3 |
| Reference work | a citation with no file | page or section number, typed | built in | M3 |
| Presentations | Anne's Stage, .pptx, .odp | slide and shape | Anne's Stage readers | M6 |
| Databases | Anne's Base, SQLite, .accdb and .mdb (as Anne's Base reads them), .dbf | table, record and field | Anne's Base readers | M6 |
| Family tree files | GEDCOM 5.5, 5.5.1, 7.0 | record and tag | Anne's Chart reader | M6 |
| Security reports | Anne's Test reports | finding | built in | M6 |
| E-books | EPUB (without DRM) | text run | built in | M8 |

Files protected by DRM or by a password you do not have are not opened.

### The public-domain shelf

For checking quotations (`source.addLibraryText`), a small set of public-domain texts can be added to a case as sources, each with its edition stated so that a quotation is checked against the wording of that edition and no other. Implemented with Project Gutenberg plain-text editions fetched on request (King James Version, Douay-Rheims, the U.S. Constitution, Bill of Rights and Declaration of Independence, or any Gutenberg number), each confirmed against the title recorded in the file. Young's Literal Translation and the JPS 1917 Tanakh are not on the shelf yet; add a downloaded copy as an ordinary source. Copyrighted translations and editions are never bundled; a user who owns a copy can add it as an ordinary source.

## Linked documents (the work being checked)

| Format | Claims captured from | Written back | Milestone |
|---|---|---|---|
| Anne's Pen, .docx | sentences, numbers, quotations, footnotes | footnotes, endnotes, comments, tracked changes | M2 (capture), M5 (notes) |
| Anne's Grid, .xlsx | cells and ranges | tick marks, cross-references, legend sheet, comments | M2, M5 |
| PDF | text runs and regions | comments (through Anne's Folio) | M2 |
| Anne's Stage, .pptx | slide text and speaker notes | comments | M6 |
| Anne's Press, Anne's Loom pages | text frames, page text | comments | M6 |
| Anne's Base | record fields | — | M6 |
| GEDCOM, Anne's Chart | persons, events, relationships | source citations | M6 |
| .odt, .ods, Markdown, LaTeX, HTML | as above | notes where the format has them | M8 |

## Exports

| Output | Formats |
|---|---|
| Proof Summary, Open Items, Research Log, Change Report | Anne's Pen, .docx, PDF, HTML, Markdown |
| Claim Table | Anne's Grid, .xlsx, .csv, PDF |
| Source List | the above, plus BibTeX, RIS and CSL-JSON |
| Evidence Map | Anne's Chart, SVG, PNG |
| Exhibit Bundle | PDF (through Anne's Folio) with bookmarks and an index page |
| Coverage Report | PDF, HTML |
| Citations | CSL styles (imported as .csl files) |

## Imports

| From | What comes in |
|---|---|
| BibTeX, RIS, CSL-JSON | reference works as sources |
| GEDCOM | source records and citations as sources and ties (`tools.gedcomCitations`) |
| W3C Web Annotation JSON | anchors on web captures |
| CSV | claims, or a list of sources |
| Another `.witness` case | sources, claims and ties (`review.merge`, `review.importTies`) |

Importers for the files of other evidence, reference and research programs will be added only where the format is publicly documented.
