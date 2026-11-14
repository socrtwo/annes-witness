# Building and running

## Web (all platforms)

Node.js 22 or later.

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build        # dist/ — static files; serve them from any web server
npm run preview      # serve dist/ locally
```

The built app works offline after the first visit (service worker) and can be installed from the browser's menu. Cases are autosaved in the browser (IndexedDB) and saved to `.witness` files with File ▸ Save.

## Tests

```bash
npm run typecheck
npm test             # unit tests (vitest): core, AI engine, readers, case file, checks, reports, CLI, catalog
npm run e2e          # browser test with Playwright + Chromium; the Claude API is mocked
python3 scripts/gen-plan.py --check   # command plan and metadata
```

For `npm run e2e`, install Playwright first if it is not on the machine: `npm install --no-save playwright && npx playwright install chromium`.

## Command line

```bash
npm run witness -- check  case.witness            # all checks; exit code 1 if any error
npm run witness -- status case.witness --strict   # counts by status; exit 1 if any Disputed or Stale
npm run witness -- report case.witness proof.md   # proof summary
npm run witness -- verify case.witness            # sealed case intact?
```

## Desktop (Electron) — configured, not yet built in CI

```bash
npm install --save-dev electron electron-builder
npm run desktop          # run
npm run desktop:dist     # installers into release/ (Windows, macOS, Linux incl. Raspberry Pi)
```

`electron/main.cjs` serves `dist/` over a private `app://` scheme with the renderer sandboxed. This path has not been run in the development environment of this version.

## Android and iOS (Capacitor) — configured, not yet built

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android      # then: npm run cap:sync && open android/ in Android Studio
npx cap add ios          # macOS with Xcode
```

`capacitor.config.json` is in place; the native projects are not yet in the repository.

## Icons and notices

```bash
npm run icons            # renders resources/icon.svg to PNGs (needs Playwright)
node scripts/gen-notices.mjs   # public/third-party-notices.txt (runs before every build)
```

## The AI features

AI ▸ Set Up AI asks for a Claude API key (or the address of a local OpenAI-compatible server). The key stays on the device: for the session only, or encrypted with a passphrase. Requests go from the browser directly to the API (the Anthropic SDK's browser mode); nothing passes through any other server. The default model is `claude-opus-5-5`; Fable 5.2, Sonnet 5.5 and Haiku 5.5 can be chosen. Requests on models that support it carry the server-side refusal fallback (`fallbacks: "default"`), so a request declined by a safety filter is retried on a fallback model; AI History records which model answered.
