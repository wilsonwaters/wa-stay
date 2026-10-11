/*
 * On Windows, points the download buttons straight at the latest installer; everywhere, shows
 * its version. Without it (no script, another system, GitHub unreachable, or a release with no
 * WA Stay installer yet) the buttons keep linking to the release page.
 */
(async function () {
  const DOWNLOADS = 'https://github.com/wilsonwaters/wa-stay/releases/download/';
  try {
    const response = await fetch(
      'https://api.github.com/repos/wilsonwaters/wa-stay/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' }, referrerPolicy: 'no-referrer' }
    );
    if (!response.ok) return;
    const release = await response.json();
    const installer = (release.assets || []).find(function (asset) {
      return (
        /^WA-Stay-Setup-\d+\.\d+\.\d+\.exe$/.test(asset.name) &&
        String(asset.browser_download_url).startsWith(DOWNLOADS)
      );
    });
    if (!installer) return;
    if (/Windows NT/.test(navigator.userAgent)) {
      document.querySelectorAll('a[data-download]').forEach(function (link) {
        link.href = installer.browser_download_url;
      });
    }
    const version = installer.name.replace(/^WA-Stay-Setup-/, '').replace(/\.exe$/, '');
    document.querySelectorAll('[data-version]').forEach(function (element) {
      element.textContent = ' · Version ' + version;
    });
  } catch {
    // The release page link stays.
  }
})();
