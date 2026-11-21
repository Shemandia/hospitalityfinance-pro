/**
 * WP-1 lint rules (HC-30, HC-33, OPS-06), checked on the syntax tree, so a
 * comment or a word inside a longer name never counts:
 *
 *   process-env  process.env is read only by the config modules.
 *   console      the API and the packages log through the logger, not console.
 *   localhost    no localhost or 127.0.0.1 address outside tests.
 *
 * Each rule has an allow list of files, with the reason next to it.
 */
import ts from "typescript";

/** Files (repo-relative, forward slashes) each rule does not apply to. */
export const ALLOW = {
  "process-env": [
    // The config modules: the one place each app reads its environment.
    /^apps\/api\/src\/config\.ts$/,
    /^apps\/web\/lib\/server\/config\.ts$/,
    // Reads PORT before Next.js starts; Next.js reads .env.local too late.
    /^apps\/web\/scripts\/next\.mjs$/
  ],
  console: [
    // Command-line programs: the terminal is their interface.
    /^apps\/api\/src\/scripts\//,
    /^apps\/api\/src\/db\/(seed|seed-integrations|demo-seed)\.ts$/
  ],
  localhost: []
};

/** process.env.X that Next.js itself sets and inlines; not configuration. */
const NEXT_BUILT_IN = new Set(["NODE_ENV", "NEXT_RUNTIME"]);

const LOCAL_ADDRESS = /\blocalhost\b|\b127\.0\.0\.1\b/;

/** Which files a rule covers at all. */
function covers(rule, file) {
  if (/(^|\/)(tests?|__tests__)\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file)) return false;
  if (rule === "console")
    return /^apps\/api\/src\//.test(file) || /^packages\/[^/]+\/src\//.test(file);
  return true;
}

function allowed(rule, file) {
  return !covers(rule, file) || ALLOW[rule].some((re) => re.test(file));
}

function isProcessEnv(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

/** The name read from process.env at `node` (process.env.NAME), if any. */
function envName(node) {
  const parent = node.parent;
  if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return parent.name.text;
  }
  return undefined;
}

/**
 * Problems in one file: [{ rule, line, text }]. `file` is repo-relative and
 * decides which rules apply.
 */
export function check(file, source) {
  const kind = /\.tsx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.[cm]?jsx?$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const problems = [];
  const report = (rule, node, text) => {
    if (allowed(rule, file)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    problems.push({ rule, line: line + 1, text });
  };

  const visit = (node) => {
    if (isProcessEnv(node)) {
      const name = envName(node);
      const builtIn = file.startsWith("apps/web/") && name && NEXT_BUILT_IN.has(name);
      if (!builtIn) {
        report(
          "process-env",
          node,
          `process.env${name ? "." + name : ""} outside the config module`
        );
      }
    } else if (ts.isIdentifier(node) && node.text === "console") {
      const parent = node.parent;
      const isPropertyName =
        parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName) report("console", node, "console; use the logger (shared/logger.ts)");
    } else if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      LOCAL_ADDRESS.test(node.text)
    ) {
      report("localhost", node, `local address in "${node.text.slice(0, 60)}"; make it a setting`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}
