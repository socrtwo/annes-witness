// Writes public/third-party-notices.txt from the licenses of the runtime dependencies.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = ["Anne's Witness — third-party notices", '', 'This application includes the following components:', ''];
for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
  const dir = join(root, 'node_modules', name);
  if (!existsSync(dir)) continue;
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lic = readdirSync(dir).find((f) => /^(license|licence|copying)(\.|$)/i.test(f));
  out.push('='.repeat(72), `${name} ${p.version} — ${p.license ?? 'see license text'}`, p.homepage ?? '', '');
  if (lic) out.push(readFileSync(join(dir, lic), 'utf8').trim(), '');
}
writeFileSync(join(root, 'public', 'third-party-notices.txt'), out.join('\n'));
console.log(`third-party notices: ${Object.keys(pkg.dependencies ?? {}).length} components`);
