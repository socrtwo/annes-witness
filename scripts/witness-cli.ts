// Command-line checks for build pipelines.
//   npm run witness -- check  case.witness          exit 1 when any check reports an error
//   npm run witness -- status case.witness          claim counts by status (exit 1 when any claim is Disputed or Stale with --strict)
//   npm run witness -- report case.witness out.md   proof summary as Markdown
//   npm run witness -- verify case.witness          verify a sealed case
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCase, verifySeal } from '../src/io/container';
import { runChecks, quickTieTest } from '../src/checks/index';
import { allStatuses, statusCounts } from '../src/core/status';
import { proofSummary } from '../src/reports/proof';
import { STATUS_LABEL, Status } from '../src/core/types';

const [cmd, file, out, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const strict = rest.includes('--strict') || out === '--strict';
if (!cmd || !file) {
  console.log('usage: witness <check|status|report|verify> <case.witness> [out.md] [--strict]');
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(file));

if (cmd === 'verify') {
  const v = await verifySeal(bytes);
  console.log(!v.sealed ? 'not sealed' : v.ok ? 'seal intact' : `seal broken:\n${v.differences.join('\n')}`);
  process.exit(v.sealed && v.ok ? 0 : 1);
}

const { data, report } = await loadCase(bytes);
for (const r of report) console.error(`repair: ${r}`);
const statuses = allStatuses(data, quickTieTest);

if (cmd === 'check') {
  const f = runChecks(data, { today: new Date().toISOString().slice(0, 10) });
  for (const x of f) console.log(`${x.severity.padEnd(7)} ${x.check.padEnd(22)} ${x.claimId ? `#${data.claims[x.claimId]?.number} ` : ''}${x.message}`);
  const errors = f.filter((x) => x.severity === 'error').length;
  console.log(`${f.length} findings, ${errors} errors`);
  process.exit(errors ? 1 : 0);
}
if (cmd === 'status') {
  const c = statusCounts(statuses);
  for (const k of Object.keys(c) as Status[]) console.log(`${STATUS_LABEL[k].padEnd(13)} ${c[k]}`);
  process.exit(strict && (c.disputed || c.stale) ? 1 : 0);
}
if (cmd === 'report') {
  const r = proofSummary(data, statuses);
  if (out && out !== '--strict') writeFileSync(out, r.markdown);
  else console.log(r.markdown);
  process.exit(0);
}
console.error(`unknown command ${cmd}`);
process.exit(2);
