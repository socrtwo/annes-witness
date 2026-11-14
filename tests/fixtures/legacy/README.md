# Legacy-format fixtures

Both files were made for the Anne's Office suite and are copied from Anne's Pen (`tests/fixtures/legacy/`, MIT, same author); none comes from a third party.

| File | How it was made |
| --- | --- |
| `word97.doc` | `soffice --headless --convert-to "doc:MS Word 97" source.fodt` (LibreOffice 24.2), from a hand-written source document |
| `sheet.xls` | `soffice --headless --convert-to "xls:MS Excel 97"` from a hand-written `source.fods` |

Other compound-file fixtures (a BIFF8 workbook with a split shared-strings table, an Outlook message) are built at test time in `tests/legacy.test.ts`.
