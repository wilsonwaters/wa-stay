/*
 * Points the download buttons straight at the latest Windows installer, and shows its version,
 * when GitHub says which file that is. Without it (no script, GitHub unreachable, or a release
 * with no WA Stay installer yet) the buttons keep linking to the release page.
 */
(async function () {
  try {
    const response = await fetch(
      'https://api.github.com/repos/wilsonwaters/wa-stay/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!response.ok) return;
    const release = await response.json();
    const installer = (release.assets || []).find(function (asset) {
      return /^WA-Stay-Setup-\d+\.\d+\.\d+\.exe$/.test(asset.name);
    });
    if (!installer) return;
    document.querySelectorAll('a[data-download]').forEach(function (link) {
      link.href = installer.browser_download_url;
    });
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (/^\d+\.\d+\.\d+$/.test(version)) {
      document.querySelectorAll('[data-version]').forEach(function (element) {
        element.textContent = ' · Version ' + version;
      });
    }
  } catch {
    // The release page link stays.
  }
})();
