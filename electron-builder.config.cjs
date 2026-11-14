// Desktop installers, built from the staged app (npm run build && node scripts/prepare-desktop.mjs).
module.exports = {
  appId: 'io.github.socrtwo.anneswitness',
  productName: "Anne's Witness",
  directories: { app: 'build/desktop-app', output: 'release', buildResources: 'resources' },
  files: ['dist/**', 'electron/**', 'package.json'],
  artifactName: 'AnnesWitness-${version}-${os}-${arch}.${ext}',
  fileAssociations: [{ ext: 'witness', name: "Anne's Witness case", mimeType: 'application/x-annes-witness', role: 'Editor', icon: 'icon.png' }],
  win: {
    icon: 'resources/icon.png',
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }, { target: 'portable', arch: ['x64'] }],
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: 'AnnesWitness-${version}-windows-${arch}-setup.${ext}' },
  portable: { artifactName: 'AnnesWitness-${version}-windows-portable.${ext}' },
  mac: {
    icon: 'resources/icon.png',
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    category: 'public.app-category.productivity',
    artifactName: 'AnnesWitness-${version}-mac-${arch}.${ext}',
  },
  linux: {
    artifactName: 'AnnesWitness-${version}-linux-${arch}.${ext}',
    icon: 'resources/icon.png',
    target: [{ target: 'AppImage', arch: ['x64', 'arm64', 'armv7l'] }, { target: 'deb', arch: ['x64', 'arm64', 'armv7l'] }],
    category: 'Office',
    maintainer: 'socrtwo <socrtwo@users.noreply.github.com>',
    synopsis: 'Tie every claim in your work to the exact spot in a source that backs it.',
  },
};
