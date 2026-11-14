// Desktop installers. Requires: npm i -D electron electron-builder
module.exports = {
  appId: 'io.github.socrtwo.anneswitness',
  productName: "Anne's Witness",
  directories: { output: 'release' },
  files: ['dist/**', 'electron/**', 'resources/icon.png', 'package.json'],
  extraMetadata: { main: 'electron/main.cjs' },
  fileAssociations: [{ ext: 'witness', name: "Anne's Witness case", mimeType: 'application/x-annes-witness', role: 'Editor' }],
  win: { target: [{ target: 'nsis', arch: ['x64', 'arm64'] }, { target: 'portable', arch: ['x64'] }] },
  mac: { target: [{ target: 'dmg', arch: ['universal'] }], category: 'public.app-category.productivity' },
  linux: { target: [{ target: 'AppImage', arch: ['x64', 'arm64', 'armv7l'] }, { target: 'deb', arch: ['x64', 'arm64'] }], category: 'Office' },
};
