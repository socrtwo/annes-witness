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

## Desktop (Electron)

`electron/main.cjs` serves `dist/` over a private `app://` scheme with a sandboxed renderer. `electron/preload.cjs` gives the page a small API (`window.witnessDesktop`): open and save dialogs, a recent-files list with pinning (kept in the app's user-data folder as `recent.json`), Show in Folder, opening a stored source with its own program, capturing web pages from the main process (so other sites are not blocked by browser CORS rules), and new windows (each with its own autosave slot).

```bash
npm ci                   # electron and electron-builder are devDependencies
npm run desktop          # build, stage build/desktop-app/, run
npm run desktop:dist     # installers in release/: Windows (x64/arm64 installer, portable), macOS universal, Linux AppImage/.deb (x64, arm64, armv7l)
```

`.witness` files are associated with the app on all three systems.

**Verified so far:** the scripts pass `node --check`, the staging script runs, and the builder configuration loads. Electron itself has not been run here, because the development environment cannot download the Electron binary. Installers are built by the Release workflow on GitHub Actions.

## Android and iOS (Capacitor)

The native projects are in the repository: `android/` (app id `io.github.socrtwo.anneswitness`, opens `.witness` files from file managers) and `ios/` (declares the `.witness` document type). Launcher icons come from `scripts/gen-android-icons.mjs` (`npm run icons:native`).

```bash
npm run android:build    # needs the Android SDK and JDK 21; APK in android/app/build/outputs/
npm run ios:sync         # then open ios/App/App.xcodeproj in Xcode (macOS)
```

Release builds are signed with your key when `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set, and with the debug key otherwise (fine for sideloading, not accepted by Google Play).

**Verified so far:** the projects were generated with `npx cap add`. Neither has been compiled here, because the Android SDK and Xcode are not available in this environment.

## Continuous integration and releases

- `.github/workflows/validate.yml`: plan check on Linux and Windows; type-check, unit tests, build and the browser test.
- `.github/workflows/android.yml`: APK and AAB on every push (manual runs can publish a prerelease). Repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` enable real signing.
- `.github/workflows/release.yml`: on a tag `v*`, a manual run, or a commit message containing `[release]`, builds web, Windows, macOS, Linux, iOS (unsigned `.ipa`) and Android, and publishes one GitHub release with checksums.

These workflows are adapted from Anne's Stage and have not yet run for this repository.

## Icons and notices

```bash
npm run icons            # renders resources/icon.svg to PNGs (needs Playwright)
node scripts/gen-notices.mjs   # public/third-party-notices.txt (runs before every build)
```

## The AI features

AI ▸ Set Up AI asks for a Claude API key (or the address of a local OpenAI-compatible server). The key stays on the device: for the session only, or encrypted with a passphrase. Requests go from the browser directly to the API (the Anthropic SDK's browser mode); nothing passes through any other server. The default model is `claude-opus-5-5`; Fable 5.2, Sonnet 5.5 and Haiku 5.5 can be chosen. Requests on models that support it carry the server-side refusal fallback (`fallbacks: "default"`), so a request declined by a safety filter is retried on a fallback model; AI History records which model answered.
