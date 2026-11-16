/**
 * @module core/config/editorconfig
 *
 * Read the Markdown line width from `.editorconfig` `max_line_length`, the
 * setting prim and editors already use, so that one value drives every
 * formatter of a project (ADR-029 amendment).
 *
 * Only what MarkSpec needs is implemented: the `.editorconfig` files are read
 * from the folder of a file up to the first `root = true` file (or the
 * filesystem root), section globs are matched with EditorConfig semantics
 * (`*`, `**`, `?`, `[...]`, `[!...]`, `{a,b}`, `{n..m}`; a glob without `/`
 * matches the file name at any depth), and later, nearer sections override
 * earlier ones. A section whose glob is malformed is ignored, as editors do.
 */

import { dirname, join, relative, SEPARATOR } from "@std/path";
import type { ReadFile } from "./mod.ts";

/** The `.editorconfig` filename. */
export const EDITORCONFIG_FILENAME = ".editorconfig";

/** One `[glob]` section of an `.editorconfig` file. */
interface Section {
  readonly glob: string;
  readonly properties: ReadonlyMap<string, string>;
}

/** A parsed `.editorconfig` file. */
interface EditorConfigFile {
  readonly directory: string;
  readonly root: boolean;
  readonly sections: readonly Section[];
}

/** Parse the text of an `.editorconfig` file (INI; `#` and `;` comments). */
function parseEditorConfig(text: string, directory: string): EditorConfigFile {
  let root = false;
  const sections: Section[] = [];
  let current: Map<string, string> | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      current = new Map();
      sections.push({ glob: header[1], properties: current });
      continue;
    }
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();
    if (current === undefined) {
      if (key === "root") root = value.toLowerCase() === "true";
    } else {
      current.set(key, value);
    }
  }
  return { directory, root, sections };
}

/** Translate an EditorConfig section glob into a regular expression, or
 * `undefined` when the glob is malformed. */
function globToRegExp(glob: string): RegExp | undefined {
  try {
    return new RegExp(`^${globPattern(glob)}$`);
  } catch {
    return undefined;
  }
}

/** The regular-expression source of an EditorConfig glob. */
function globPattern(glob: string): string {
  let pattern = "";
  let braces = 0;
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "\\" && index + 1 < glob.length) {
      pattern += glob[++index].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else if (char === "*") {
      if (glob[index + 1] === "*") {
        pattern += ".*";
        index++;
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (char === "[") {
      const close = glob.indexOf("]", index + 1);
      if (close < 0) {
        pattern += "\\[";
      } else {
        const body = glob.slice(index + 1, close);
        pattern += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        index = close;
      }
    } else if (char === "{") {
      const close = glob.indexOf("}", index + 1);
      const range = close < 0
        ? null
        : /^(-?\d+)\.\.(-?\d+)$/.exec(glob.slice(index + 1, close));
      if (range) {
        // `{n..m}` matches any integer between n and m.
        const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) =>
          a - b
        );
        const numbers: string[] = [];
        for (let n = low; n <= high && numbers.length <= 10_000; n++) {
          numbers.push(String(n));
        }
        pattern += `(?:${numbers.join("|")})`;
        index = close;
        continue;
      }
      if (close < 0) {
        pattern += "\\{";
        continue;
      }
      braces++;
      pattern += "(?:";
    } else if (char === "}" && braces > 0) {
      braces--;
      pattern += ")";
    } else if (char === "," && braces > 0) {
      pattern += "|";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return pattern;
}

/** Whether `section` of a file in `directory` applies to `filePath`. */
function sectionMatches(
  section: Section,
  directory: string,
  filePath: string,
): boolean {
  const rel = relative(directory, filePath).split(SEPARATOR).join("/");
  if (rel.startsWith("../")) return false;
  const glob = section.glob.startsWith("/")
    ? section.glob.slice(1)
    : section.glob.includes("/")
    ? section.glob
    : `**/${section.glob}`;
  const regExp = globToRegExp(glob);
  if (regExp === undefined) return false;
  // `**/x` also matches `x` at the top level.
  return regExp.test(rel) ||
    (glob.startsWith("**/") &&
      (globToRegExp(glob.slice(3))?.test(rel) ?? false));
}

/**
 * The `.editorconfig` files that apply to `filePath`, nearest first, up to
 * and including the first one declaring `root = true`.
 */
async function editorConfigChain(
  filePath: string,
  readFile: ReadFile,
): Promise<EditorConfigFile[]> {
  const chain: EditorConfigFile[] = [];
  let directory = dirname(filePath);
  for (;;) {
    const text = await readFile(join(directory, EDITORCONFIG_FILENAME));
    if (text !== undefined) {
      const file = parseEditorConfig(text, directory);
      chain.push(file);
      if (file.root) break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return chain;
}

/** Result of {@linkcode readLineWidth}. */
export interface EditorConfigLineWidth {
  /** The `max_line_length` that applies, as written; absent when none does. */
  readonly value?: string;
  /** The `.editorconfig` file that set it. */
  readonly source?: string;
}

/**
 * The `max_line_length` that `.editorconfig` gives `filePath`, or no value
 * when none applies.
 */
export async function readLineWidth(
  filePath: string,
  readFile: ReadFile,
): Promise<EditorConfigLineWidth> {
  const chain = await editorConfigChain(filePath, readFile);
  let result: EditorConfigLineWidth = {};
  // Farthest first, so that nearer files and later sections win.
  for (const file of chain.reverse()) {
    for (const section of file.sections) {
      const value = section.properties.get("max_line_length");
      if (value === undefined) continue;
      if (sectionMatches(section, file.directory, filePath)) {
        result = {
          value,
          source: join(file.directory, EDITORCONFIG_FILENAME),
        };
      }
    }
  }
  return result;
}

/**
 * The `max_line_length` that `.editorconfig` gives a Markdown file in
 * `directory`, or no value when none applies.
 */
export function readMarkdownLineWidth(
  directory: string,
  readFile: ReadFile,
): Promise<EditorConfigLineWidth> {
  return readLineWidth(join(directory, "markspec.md"), readFile);
}
