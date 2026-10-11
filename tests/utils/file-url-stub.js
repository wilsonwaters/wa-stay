// Jest stand-in for plain asset imports (`import logoUrl from './logo.svg'`). Vite turns those
// into a URL string, so tests get a URL-shaped string too. `?raw` imports still load the file.
// Assets with a named stub in tests/utils/asset-urls/ get a URL that names the file instead.
module.exports = '/test-file-stub.svg';
