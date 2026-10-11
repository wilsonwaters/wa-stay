/**
 * Jest transform for Vite `?raw` imports: the module's default export is the file's text,
 * exactly as Vite serves it. jest.config.js maps `x.svg?raw` / `x.css?raw` onto the file.
 */
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
