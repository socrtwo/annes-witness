# Contributing to Anne's Witness

Thank you for your interest. Anne's Witness is at the **planning** stage: there is no code yet. The most useful contributions now are:

- **Feedback on the concept and the plan:** missing commands, commands in the wrong place, status rules that give a wrong answer in a situation you know, and corrections to [docs/ORIGINALITY.md](docs/ORIGINALITY.md), [docs/AI-PLAN.md](docs/AI-PLAN.md), [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) or [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md). To change commands, edit [docs/commands-plan.src.txt](docs/commands-plan.src.txt) and run `python3 scripts/gen-plan.py`; it fails on duplicate ids, unknown origin codes and shortcut conflicts. Open an issue with the *Feature request* template.
- **Knowledge of the trades:** if you prove family relationships, tie out financial statements, check facts for a publisher or edit texts from manuscripts, tell us how you do it and what the plan gets wrong. Describe practices in your own words; do not paste text from standards, manuals or textbooks.
- **Test cases:** small made-up sets of sources that disagree, with the answer you would reach and why. Do not attach records of real living people, real financial records, or files you do not have the right to share.

## Ground rules

- **Clean room.** Do not contribute code, text, templates, sample data, menu text or icons copied from proprietary software, its documentation or its help files. Work from public specifications, permissively licensed open-source references and your own knowledge. See [docs/LEGAL.md](docs/LEGAL.md).
- **Generic names.** Use the generic terms in docs/LEGAL.md (source, anchor, claim, tie, reckoning…) in the interface and code.
- **No missing commands.** Every feature is a command in the registry with an id, label, icon, tab and group (or *not in tabs*), so it can go on the Quick Access Bar, custom tabs, the menu bar, shortcuts and macros and be found by command search.
- **Sources are never written.** Nothing changes a source file. Anything that repairs a file writes a new file.
- **Status is computed.** No command may set Supported, Corroborated or Settled directly; they follow from confirmed ties and written conclusions.
- **AI proposes, people confirm.** Every AI result that points at a source passes the verification gate in docs/AI-PLAN.md before it is shown.
- **American English** in the interface, code comments and documentation.
- **Licenses.** Contributions are accepted under the MIT License. New dependencies must use a permissive license (MIT, BSD, Apache 2.0, ISC, public domain, SIL OFL for fonts).

## Checks

```bash
python3 scripts/gen-plan.py          # regenerate docs/COMMANDS-PLAN.md and docs/commands-plan.json
python3 scripts/gen-plan.py --check  # validate the plan and AnnesWitness.meta.json
```

Python 3.10 or later, standard library only. When the application scaffold arrives (milestone M1), it will use Node.js and the same `npm run dev`, `npm test`, `npm run typecheck` and `npm run build` commands as the sister apps.
