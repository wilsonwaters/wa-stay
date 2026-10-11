/**
 * Tailwind 4 runs as a PostCSS plugin. Its configuration is CSS-first, in
 * src/renderer/styles/index.css. The tests compile the stylesheet through this same plugin
 * (tests/utils/tailwind.ts), so the build and the CSS tests cannot drift apart.
 */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
