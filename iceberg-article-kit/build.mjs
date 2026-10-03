import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import juice from "juice";

const kitRoot = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_TAGS = new Set([
  "article", "header", "footer", "section", "nav", "aside",
  "h1", "h2", "h3", "p", "ul", "ol", "li", "a", "strong", "em",
  "code", "pre", "span", "blockquote", "table", "thead", "tbody",
  "tr", "th", "td", "figure", "figcaption", "img", "kbd", "hr",
  "div", "br", "caption",
]);

const VOID_TAGS = new Set(["img", "br", "hr"]);

const ALLOWED_CLASSES = new Set([
  "ib-article", "ib-header", "ib-title", "ib-meta", "ib-tags", "ib-tag",
  "ib-tldr", "ib-toc", "ib-toc-title",
  "ib-callout", "ib-callout-note", "ib-callout-tip", "ib-callout-warn",
  "ib-callout-danger", "ib-callout-label",
  "ib-code", "ib-code-label", "ib-pre",
  "ib-tok-kw", "ib-tok-str", "ib-tok-com", "ib-tok-fn", "ib-tok-num", "ib-tok-type",
  "ib-diff", "ib-diff-add", "ib-diff-del", "ib-diff-chg",
  "ib-table-wrap", "ib-table", "ib-quote", "ib-kbd",
  "ib-figure", "ib-figcaption", "ib-img",
  "ib-steps", "ib-step", "ib-step-num", "ib-step-body",
  "ib-cards", "ib-card", "ib-card-title",
  "ib-flow", "ib-flow-step", "ib-flow-arrow",
  "ib-refs", "ib-footer",
]);

const ALLOWED_ATTRS = new Set([
  "class", "href", "src", "alt", "id", "colspan", "rowspan", "title",
  "width", "height", "start", "cite", "loading", "decoding", "lang",
  "aria-label", "data-theme",
]);

const TOKEN_MARK = /\/\* @ib-tokens (light|dark) \*\/([\s\S]*?)\/\* @ib-tokens-end \*\//g;

export function extractArticle(html) {
  const start = html.search(/<article\b[^>]*\bib-article\b[^>]*>/i);
  if (start < 0) {
    throw new Error('class="ib-article" の article が見つかりません');
  }
  const openEnd = html.indexOf(">", start);
  let depth = 1;
  const re = /<\/?article\b[^>]*>/gi;
  re.lastIndex = openEnd + 1;
  let match;
  while ((match = re.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return html.slice(start, match.index + match[0].length);
    }
  }
  throw new Error("article が閉じていません");
}

export function validateFragment(html) {
  const errors = [];
  const fragment = html.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!/^<article\b[^>]*>[\s\S]*<\/article>$/i.test(fragment)) {
    errors.push("ルートは article 要素 1 つだけにしてください");
  }
  if (!/\bib-article\b/.test(fragment.slice(0, fragment.indexOf(">") + 1))) {
    errors.push('ルートの article に class="ib-article" が必要です');
  }

  const stack = [];
  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let articleOpens = 0;
  let match;
  while ((match = tagRe.exec(fragment))) {
    const raw = match[0];
    const name = match[1].toLowerCase();
    const attrs = match[2];
    const closing = raw.startsWith("</");
    if (!ALLOWED_TAGS.has(name)) {
      if (!closing) errors.push(`使えない要素です: <${name}>`);
      continue;
    }
    if (closing) {
      const open = stack.pop();
      if (open !== name) {
        errors.push(`閉じタグが対応しません: </${name}>（開いているのは ${open ?? "なし"}）`);
      }
      continue;
    }
    if (name === "article") articleOpens += 1;
    if (!VOID_TAGS.has(name) && !raw.endsWith("/>")) stack.push(name);
    checkAttrs(name, attrs, errors);
  }
  if (stack.length) {
    errors.push(`閉じられていない要素があります: ${stack.join(", ")}`);
  }
  if (articleOpens !== 1) {
    errors.push("article は 1 つだけにしてください");
  }
  const roots = fragment.match(/\bib-article\b/g) ?? [];
  if (roots.length !== 1) {
    errors.push("ib-article はルートに 1 つだけ付けてください");
  }
  return errors;
}

function checkAttrs(tag, attrs, errors) {
  const attrRe = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(attrs))) {
    const attr = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (attr.startsWith("on")) {
      errors.push(`イベント属性は使えません: ${attr}`);
      continue;
    }
    if (!ALLOWED_ATTRS.has(attr)) {
      errors.push(`使えない属性です: ${tag} の ${attr}`);
      continue;
    }
    if (attr === "class") {
      for (const token of value.split(/\s+/).filter(Boolean)) {
        if (!ALLOWED_CLASSES.has(token)) {
          errors.push(`使えない class です: ${token}`);
        }
      }
    }
    if (attr === "id" && !/^[A-Za-z][\w:-]*$/.test(value)) {
      errors.push(`id の形式が不正です: ${value}`);
    }
    if (attr === "data-theme" && value !== "light" && value !== "dark") {
      errors.push('data-theme は "light" か "dark" だけです');
    }
    if ((attr === "href" || attr === "src") && /^(javascript|data):/i.test(value.trim())) {
      errors.push(`${attr} に javascript: や data: は使えません`);
    }
    if (attr === "src" && /\.svg(\?|#|$)/i.test(value)) {
      errors.push("SVG は使えません");
    }
    if (tag === "img" && attr === "src" && !value.trim()) {
      errors.push("img の src が空です");
    }
  }
  if (tag === "img" && !/\balt\s*=/.test(attrs)) {
    errors.push("img には alt が必要です");
  }
}

function varsIn(block) {
  const vars = {};
  for (const match of block.matchAll(/(--ib-[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function sameVars(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.join() === bk.join() && ak.every((key) => a[key] === b[key]);
}

export function readTokens(css) {
  const grouped = { light: [], dark: [] };
  TOKEN_MARK.lastIndex = 0;
  for (const match of css.matchAll(TOKEN_MARK)) {
    grouped[match[1]].push(varsIn(match[2]));
  }
  for (const mode of ["light", "dark"]) {
    if (grouped[mode].length < 2) {
      throw new Error(`${mode} のトークン定義が 2 箇所ありません`);
    }
    if (!grouped[mode].every((block) => sameVars(block, grouped[mode][0]))) {
      throw new Error(`${mode} のトークン定義が一致しません`);
    }
    if (Object.keys(grouped[mode][0]).length < 10) {
      throw new Error(`${mode} のトークンが不足しています`);
    }
  }
  return { light: grouped.light[0], dark: grouped.dark[0] };
}

export function cssForInline(css, tokens) {
  TOKEN_MARK.lastIndex = 0;
  const stripped = css.replace(TOKEN_MARK, "");
  const missing = new Set();
  const resolved = stripped.replace(/var\(\s*(--ib-[\w-]+)\s*(?:,[^)]*)?\)/g, (full, name) => {
    if (!(name in tokens)) {
      missing.add(name);
      return full;
    }
    return tokens[name];
  });
  if (missing.size) {
    throw new Error(`未定義の変数です: ${[...missing].join(", ")}`);
  }
  if (/var\(\s*--ib-/.test(resolved)) {
    throw new Error("解決できない CSS 変数が残っています");
  }
  return resolved;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function articleTitle(fragment) {
  const match = fragment.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return "article";
  return match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "article";
}

function wrapDocument(title, head, body) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}
</head>
<body>
${body}
</body>
</html>
`;
}

function leftoverIsSafe(cssText) {
  const rules = cssText.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!rules) return true;
  if (/@media\b/.test(rules)) return false;
  return onlyPseudoSelectors(rules);
}

function onlyPseudoSelectors(rules) {
  for (const match of rules.matchAll(/(^|})([^{}@]+)\{/g)) {
    const selector = match[2].trim();
    if (!selector) continue;
    const parts = selector.split(",");
    for (const part of parts) {
      if (!/:(?:hover|focus-visible|focus|selection)\b/.test(part)) return false;
    }
  }
  return true;
}

export function inlineFragment(fragment, css, mode) {
  const page = `body{margin:0;background:${mode === "dark" ? "#0b0c10" : "#c5c8d4"}}`;
  const wrapped = wrapDocument(articleTitle(fragment), "<!-- 投稿するのは article 要素です。html と head はプレビュー用です。 -->", fragment);
  const juiced = juice.inlineContent(wrapped, `${page}\n${css}`, {
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
  });
  const styles = [...juiced.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const style of styles) {
    if (!leftoverIsSafe(style[1])) {
      throw new Error(`インライン化できない規則が残っています:\n${style[1].trim()}`);
    }
  }
  const withoutStyle = juiced.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  if (/var\(\s*--ib-/.test(withoutStyle)) {
    throw new Error("インライン結果に CSS 変数が残っています");
  }
  return withoutStyle;
}

function parseArgs(argv) {
  const positional = [];
  const modes = [];
  let outDir = path.join(kitRoot, "dist");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      const mode = argv[++i];
      if (mode !== "light" && mode !== "dark") {
        throw new Error("--mode は light か dark です");
      }
      modes.push(mode);
    } else if (arg === "--out") {
      outDir = path.resolve(argv[++i] ?? "");
    } else if (arg === "--help") {
      positional.push(arg);
    } else {
      positional.push(arg);
    }
  }
  return { positional, modes: modes.length ? modes : ["light", "dark"], outDir };
}

function main() {
  const { positional, modes, outDir } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1 || positional[0] === "--help") {
    console.log("usage: node build.mjs <html> [--mode light|dark] [--out dir]");
    process.exit(positional[0] === "--help" ? 0 : 1);
  }
  const input = path.resolve(positional[0]);
  const html = fs.readFileSync(input, "utf8");
  const fragment = extractArticle(html);
  const errors = validateFragment(fragment);
  if (errors.length) {
    console.error(`${path.basename(input)} を検証できませんでした`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const css = fs.readFileSync(path.join(kitRoot, "iceberg.css"), "utf8");
  const tokens = readTokens(css);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(input, path.extname(input));
  const title = articleTitle(fragment);
  const styleHtml = wrapDocument(
    title,
    `<style>\n${css}\nbody{margin:0;background:#c5c8d4}\n@media (prefers-color-scheme: dark){body{background:#0b0c10}}\n</style>`,
    fragment,
  );
  const stylePath = path.join(outDir, `${base}.style.html`);
  fs.writeFileSync(stylePath, styleHtml);
  console.log(`wrote ${path.relative(process.cwd(), stylePath)}`);

  for (const mode of modes) {
    const inlined = inlineFragment(fragment, cssForInline(css, tokens[mode]), mode);
    const inlinePath = path.join(outDir, `${base}.inline.${mode}.html`);
    fs.writeFileSync(inlinePath, inlined);
    console.log(`wrote ${path.relative(process.cwd(), inlinePath)}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
