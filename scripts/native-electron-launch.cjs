// Keep argument boundaries intact and retain Chromium's sandbox on every host.
function nativeElectronLaunch(platform, electron, args) {
  return platform === 'linux'
    ? { command: 'xvfb-run', args: ['-a', electron, ...args] }
    : { command: electron, args: [...args] };
}

module.exports = { nativeElectronLaunch };
