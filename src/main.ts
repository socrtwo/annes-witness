import './styles.css';
import { app } from './ui/app';
import { mountShell, renderShell, installKeys } from './ui/shell';
import { renderLayout } from './ui/views';
import { onError, onAfterRun, onBeforeRun } from './ui/registry';
import { showError } from './ui/common';
import { registerFileCommands } from './ui/cmd-file';
import { registerCaseCommands } from './ui/cmd-case';
import { registerCheckCommands } from './ui/cmd-check';
import { registerAiCommands } from './ui/cmd-ai';
import { registerPlatformCommands } from './ui/cmd-platform';
import { registerExtraCommands } from './ui/cmd-extra';
import { h } from './ui/dom';

registerFileCommands();
registerCaseCommands();
registerCheckCommands();
registerAiCommands();
registerPlatformCommands();
registerExtraCommands();

const theme = localStorage.getItem('annes-witness.theme');
if (theme) document.documentElement.dataset.theme = theme;
app.store.user = localStorage.getItem('annes-witness.user') ?? 'me';

const top = h('header.top');
const main = h('main#main');
const bottom = h('footer.bottom');
document.getElementById('app')!.replaceChildren(top, main, bottom);
mountShell(top, bottom);

app.onRender(() => {
  document.body.classList.toggle('patterns', app.data.settings.statusPatterns);
  renderShell();
  renderLayout(main);
});
onError((id, e) => showError(id, e));
onBeforeRun((id) => (window as any).__recordCommand?.(id));
onAfterRun(() => app.render());
installKeys();

window.addEventListener('beforeunload', () => { app.autosave(); });

(async () => {
  const restored = await app.restore().catch(() => false);
  if (!restored) app.render();
  (window as any).__app = app; // for automated tests
})();

if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol !== 'file:')
  navigator.serviceWorker.register('./sw.js').catch(() => {});
