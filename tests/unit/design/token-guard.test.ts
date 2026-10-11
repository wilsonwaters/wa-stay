/**
 * @jest-environment node
 *
 * Token guard: new renderer code builds only on design tokens.
 * Scans components/ui, components/brand, app, features, api and components/LocationCard* for raw
 * Tailwind colour classes, hex literals, numeric colour functions and emoji. The pre-redesign
 * pages in those folders are skipped by an explicit list (LEGACY_FILES) that only ever shrinks.
 *
 * A line that legitimately needs one of these (a "Site #101" label, `querySelector('#add')`)
 * opts out with a `token-guard-ignore` comment on that line, ideally with a reason:
 *   <p>Site #101</p> {/* token-guard-ignore: a site number, not a colour *\/}
 */
import fs from 'fs';
import path from 'path';
import { stripComments } from '../../utils/strip-comments';

const RENDERER = path.resolve(__dirname, '../../../src/renderer');
const SCAN_DIRS = [
  'components/ui',
  'components/accounts',
  'components/brand',
  'components/providers',
  'components/stay',
  'app',
  'features',
  'api',
  'hooks',
];
const SCAN_FILE_PREFIXES = [
  'components/Countdown',
  'components/countdownFormat',
  'components/ComingSoonBanner',
  'components/LocationCard',
  'components/LocationCombobox',
  'components/PlacePhoto',
  'components/StepFlow',
  'components/locationFormat',
  'components/timeFormat',
];
const SOURCE = /\.(ts|tsx)$/;
const IGNORE_MARKER = 'token-guard-ignore';

/**
 * Pre-redesign pages, moved unchanged into features/<domain>/legacy/ by D3. The U tasks delete
 * an entry when they rebuild its page. The list never grows: a new file is held to the guard.
 */
const LEGACY_FILES: string[] = [];
/** The length LEGACY_FILES had when D3 wrote it. Lower it as entries go; never raise it. */
const LEGACY_FILES_MAX = 0;

/** Every Tailwind utility that takes a colour. */
const COLOUR_UTILITY =
  'bg|text|text-shadow|border(?:-(?:[xytrblse]|bs|be))?|ring(?:-offset)?|inset-ring|inset-shadow|shadow|drop-shadow|fill|stroke|from|via|to|outline|divide|placeholder|decoration|caret|accent|mask(?:-(?:linear|radial|conic|[xytrbl]))?-(?:from|to)';
const PALETTE_COLOUR =
  'slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary';

/** `bg-gray-500`, `accent-blue-600`, `text-primary-600`: Tailwind's palette, not our tokens. */
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITY})-(?:${PALETTE_COLOUR})-\\d{2,3}\\b`,
  'g'
);
/** `bg-white`, `text-black/50`: there are no white or black tokens, use surface, fg-inverse, fg. */
const WHITE_BLACK_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITY})-(?:white|black)(?![\\w-])`,
  'g'
);
const HEX_LITERAL = /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
/** `rgb(0 0 0)`, `rgba(255,0,0,.5)`, `hsl(210 50% 40%)`; `rgb(var(--ws-x))` is fine. */
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+.\d][^)\n]*\)?/gi;
/** Candidates; `isEmoji` decides. A pictograph optionally forced to emoji style (U+FE0F). */
const PICTOGRAPH = /\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|\p{S}\uFE0F|\u20E3/gu;

/**
 * Only real emoji: characters shown as emoji by default, pictographs from the emoji planes,
 * keycaps, and any symbol forced to emoji style with U+FE0F. Typographic symbols that
 * default to text (© ® ™ ↔ → ★) pass.
 */
function isEmoji(match: string): boolean {
  const base = match.codePointAt(0) ?? 0;
  return (
    match.endsWith('\uFE0F') ||
    match === '\u20E3' ||
    base >= 0x1f000 ||
    /\p{Emoji_Presentation}/u.test(String.fromCodePoint(base))
  );
}

type Rule = 'palette class' | 'white/black class' | 'hex literal' | 'colour function' | 'emoji';

interface Violation {
  line: number;
  rule: Rule;
  match: string;
}

/** Lines whose own comment carries the opt-out marker (a marker inside a string does not count). */
function ignoredLines(source: string, code: string): Set<number> {
  const original = source.split(/\r?\n/);
  const stripped = code.split(/\r?\n/);
  const lines = new Set<number>();
  original.forEach((text, i) => {
    if (text.includes(IGNORE_MARKER) && !stripped[i].includes(IGNORE_MARKER)) lines.add(i + 1);
  });
  return lines;
}

function scanSource(source: string): Violation[] {
  const code = stripComments(source);
  const ignored = ignoredLines(source, code);
  const lineOf = (index: number) => code.slice(0, index).split(/\r?\n/).length;
  const found: Violation[] = [];
  const rules: [Rule, RegExp, ((m: string) => boolean)?][] = [
    ['palette class', PALETTE_CLASS],
    ['white/black class', WHITE_BLACK_CLASS],
    ['hex literal', HEX_LITERAL],
    ['colour function', COLOUR_FUNCTION],
    ['emoji', PICTOGRAPH, isEmoji],
  ];
  for (const [rule, regex, keep] of rules) {
    for (const m of code.matchAll(regex)) {
      const line = lineOf(m.index ?? 0);
      if (ignored.has(line) || (keep && !keep(m[0]))) continue;
      found.push({ line, rule, match: m[0].replace(/\uFE0F$/, '') });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

function filesToScan(): string[] {
  const fromDirs = SCAN_DIRS.flatMap((d) => walk(path.join(RENDERER, d)));
  const fromPrefixes = SCAN_FILE_PREFIXES.flatMap((prefix) => {
    const dir = path.join(RENDERER, path.dirname(prefix));
    const base = path.basename(prefix);
    return walk(dir).filter((f) => path.dirname(f) === dir && path.basename(f).startsWith(base));
  });
  const legacy = new Set(LEGACY_FILES.map((f) => path.join(RENDERER, f)));
  return [...new Set([...fromDirs, ...fromPrefixes])].filter((f) => !legacy.has(f));
}

const matches = (source: string) => scanSource(source).map((v) => v.match);

describe('token guard self-test', () => {
  it('flags raw palette classes, including the legacy primary scale', () => {
    expect(
      matches(
        'const a = "bg-gray-500 hover:text-primary-600"; const b = `focus:ring-sky-300 divide-stone-200 border-t-gray-200`;'
      )
    ).toEqual([
      'bg-gray-500',
      'text-primary-600',
      'ring-sky-300',
      'divide-stone-200',
      'border-t-gray-200',
    ]);
  });

  it("flags Tailwind 4's new palettes and colour utilities", () => {
    expect(
      matches(
        'className="bg-mauve-500 inset-shadow-gray-500 text-shadow-sky-300 border-s-gray-200 mask-t-from-gray-500"'
      )
    ).toEqual([
      'bg-mauve-500',
      'inset-shadow-gray-500',
      'text-shadow-sky-300',
      'border-s-gray-200',
      'mask-t-from-gray-500',
    ]);
  });

  it("accepts Tailwind 4's sizes on those utilities", () => {
    expect(
      scanSource(
        'className="inset-shadow-xs text-shadow-sm drop-shadow-md border-s-2 mask-t-from-50%"'
      )
    ).toEqual([]);
  });

  it('flags hex literals and emoji, and reports the line', () => {
    const v = scanSource(
      "const a = 1;\nconst c = '#C4432A';\nconst d = { color: '#fff' };\nconst e = '\u{1F3D5}\uFE0F';"
    );
    expect(v).toEqual([
      { line: 2, rule: 'hex literal', match: '#C4432A' },
      { line: 3, rule: 'hex literal', match: '#fff' },
      { line: 4, rule: 'emoji', match: '\u{1F3D5}' },
    ]);
  });

  it('accepts semantic classes, routes, entities and comments', () => {
    const clean = [
      'className="bg-accent text-accent-fg hover:bg-accent-hover border-border-strong ring-focus"',
      'className="text-fg-muted bg-surface-subtle from-surface-subtle via-canvas shadow-card"',
      'className="accent-accent bg-transparent text-current border-surface text-fg-inverse"',
      '<a href="#/__design">Design</a> <span>3&#8211;5 Oct</span>',
      'const url = "https://example.com/#anchor";',
      '// legacy note: bg-gray-500, bg-white, rgb(0 0 0) and #fff are fine in a comment',
      '/* text-red-600 #C4432A */',
      'const s = "photo-gray-500 is not a class";',
      'const w = "whitespace-nowrap text-white-ish is-black-box";',
    ].join('\n');
    expect(scanSource(clean)).toEqual([]);
  });

  describe('emoji', () => {
    it('allows typographic symbols that are not emoji', () => {
      expect(
        scanSource('<p>© 2026 WA Stay® · Fraunces™ · 3 ↔ 5 Oct → Book · ★ 4.8 · ☀ ✔</p>')
      ).toEqual([]);
    });

    it('flags real emoji, pictographs and symbols forced to emoji style', () => {
      expect(
        matches('<p>Done ✅ ⚡ \u{1F600} \u{1F3D5} ❤\uFE0F ★\uFE0F 1\uFE0F\u20E3</p>')
      ).toEqual(['✅', '⚡', '\u{1F600}', '\u{1F3D5}', '❤', '★', '\u20E3']);
    });
  });

  describe('white, black and accent-* colours', () => {
    it('flags raw white and black colour utilities, with or without alpha and variants', () => {
      expect(
        matches(
          'className="bg-white text-white hover:bg-black border-white/50 ring-black ring-offset-white fill-white divide-black accent-white"'
        )
      ).toEqual([
        'bg-white',
        'text-white',
        'bg-black',
        'border-white',
        'ring-black',
        'ring-offset-white',
        'fill-white',
        'divide-black',
        'accent-white',
      ]);
    });

    it("flags white and black on Tailwind 4's colour utilities", () => {
      expect(
        matches('className="inset-ring-white text-shadow-black drop-shadow-black/50"')
      ).toEqual(['inset-ring-white', 'text-shadow-black', 'drop-shadow-black']);
    });

    it('flags raw accent-* palette colours (checkbox and radio accent-color)', () => {
      expect(
        matches('<input type="checkbox" className="accent-blue-600 focus:accent-primary-500" />')
      ).toEqual(['accent-blue-600', 'accent-primary-500']);
    });
  });

  describe('colour functions', () => {
    it('flags rgb, rgba, hsl and modern colour functions with numeric arguments', () => {
      expect(
        scanSource(
          "const a = { color: 'rgb(255 0 0)' };\nconst b = 'rgba( 0, 0, 0, .5)';\nconst c = `hsl(210 50% 40%)`;\nconst d = 'bg-[hsla(-10,50%,40%,1)] oklch(0.7 0.1 200)';"
        )
      ).toEqual([
        { line: 1, rule: 'colour function', match: 'rgb(255 0 0)' },
        { line: 2, rule: 'colour function', match: 'rgba( 0, 0, 0, .5)' },
        { line: 3, rule: 'colour function', match: 'hsl(210 50% 40%)' },
        { line: 4, rule: 'colour function', match: 'hsla(-10,50%,40%,1)' },
        { line: 4, rule: 'colour function', match: 'oklch(0.7 0.1 200)' },
      ]);
    });

    it('accepts token colours built from CSS variables', () => {
      const tokens = [
        "style={{ color: 'rgb(var(--ws-ocean-500))' }}",
        'const c = `rgb(var(--ws-${tone}) / 0.4)`;',
        "background: 'rgb( var(--ws-surface) )'",
      ].join('\n');
      expect(scanSource(tokens)).toEqual([]);
    });
  });

  describe('comments', () => {
    it('does not treat // inside a string or template literal as a comment', () => {
      expect(
        matches(
          [
            'const a = "a // b"; const x = "bg-gray-500";',
            "const b = 'see // here'; const y = '#fff';",
            'const c = `x // ${"bg-white"} //`; const z = "text-black";',
          ].join('\n')
        )
      ).toEqual(['bg-gray-500', '#fff', 'bg-white', 'text-black']);
    });

    it('does not treat /* inside a string as a comment', () => {
      expect(matches('const glob = "src/**/*.tsx"; const x = "bg-gray-500"; // */')).toEqual([
        'bg-gray-500',
      ]);
    });

    it('still strips real comments after strings, and in template expressions', () => {
      expect(
        scanSource(
          [
            'const a = "ok"; // bg-gray-500',
            'const b = `${x /* #fff */} ok`; /* text-white */',
            '{/* bg-black */}<p>Visit https://example.com today</p>',
          ].join('\n')
        )
      ).toEqual([]);
    });

    it('keeps line numbers across multi-line comments and templates', () => {
      expect(scanSource('/*\n bg-gray-500\n*/\nconst t = `\n// not a comment\nbg-white`;')).toEqual(
        [{ line: 6, rule: 'white/black class', match: 'bg-white' }]
      );
    });

    it('does not treat an escaped slash in a regex literal as a comment', () => {
      expect(matches('const re = /^https?:\\/\\//; const x = "bg-white";')).toEqual(['bg-white']);
    });

    it('lets an apostrophe in JSX text swallow at most the rest of its line', () => {
      expect(matches('<p>Don\'t</p>\n<p className="bg-white" />')).toEqual(['bg-white']);
    });
  });

  describe('opt-out marker', () => {
    it('skips every rule on a line whose comment says token-guard-ignore', () => {
      expect(
        scanSource(
          [
            '<p>Site #101</p> {/* token-guard-ignore: a site number, not a colour */}',
            "document.querySelector('#add'); // token-guard-ignore: element id",
            '<p>Site #102</p>',
          ].join('\n')
        )
      ).toEqual([{ line: 3, rule: 'hex literal', match: '#102' }]);
    });

    it('only honours the marker in a comment, not inside a string', () => {
      expect(matches('const s = "token-guard-ignore bg-white";')).toEqual(['bg-white']);
    });
  });
});

describe('token guard', () => {
  const files = filesToScan();

  it('scans the design-system folders (components/ui, app and api at least)', () => {
    for (const dir of ['components/ui', 'app', 'api']) {
      const prefix = path.join(RENDERER, dir) + path.sep;
      expect(files.some((f) => f.startsWith(prefix))).toBe(true);
    }
  });

  it('skips only the listed legacy files, each of which still exists', () => {
    for (const file of LEGACY_FILES) {
      expect(fs.existsSync(path.join(RENDERER, file))).toBe(true);
      expect(files).not.toContain(path.join(RENDERER, file));
    }
  });

  it('never grows the legacy list', () => {
    expect(new Set(LEGACY_FILES).size).toBe(LEGACY_FILES.length);
    expect(LEGACY_FILES.length).toBeLessThanOrEqual(LEGACY_FILES_MAX);
  });

  it('finds no raw colour classes, hex literals, colour functions or emoji', () => {
    const report = files.flatMap((file) =>
      scanSource(fs.readFileSync(file, 'utf8')).map(
        (v) => `${path.relative(RENDERER, file)}:${v.line} ${v.rule} "${v.match}"`
      )
    );
    expect(report).toEqual([]);
  });
});
