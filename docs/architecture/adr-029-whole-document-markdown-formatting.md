# ADR-029 — Whole-Document Markdown Formatting

## Status

Accepted (2026-07-02). Closes #649. Amended (2026-11-16): prose wrapping is a
project setting — see [Amendment](#amendment--configurable-prose-wrapping).

## Context

`markspec fmt` formatted only entry-block mechanics — ULID stamping, trailer
indentation, trailing backslashes, modal-keyword case. Surrounding Markdown
(overview chapters, context prose, headings, tables, lists) passed through
verbatim, and tables were silently skipped (#649). Authors expect `markspec fmt`
to be _the_ formatter for MarkSpec documents; today a second tool (dprint) is
required for the prose.

## Decision

`markspec fmt` formats the entire Markdown document by default, Markdown files
only, with a fixed zero-config style, via the embedded dprint-markdown WASM
plugin (`@dprint/formatter` host, exact-pinned `@dprint/markdown@0.20.0`),
lazily loaded on the fmt code path.

Style: `lineWidth` 80 (soft target — table rows, links/references, and inline
code may exceed it and are never split), `textWrap` always, emphasis
underscores, strong asterisks, dashes for lists; line endings follow the file's
detected convention. dprint's `<!-- dprint-ignore -->` directives work as a
per-block opt-out, but an ignore-start/end pair MUST NOT span an entry block
(segments format independently).

Entry-block coexistence (approach B): prose segments outside entry blocks and
each entry's AST-canonical body go through dprint; title lines and trailers
never do. Every dprint rewrite is gated by a CommonMark-semantic equivalence
comparator (`markdownSemanticallyEquivalent`, mdast-based: positions elided,
whitespace runs in text values collapsed) — soft-wrap positions and delimiter
styles compare equal, content changes do not. A rejected rewrite is kept as-was
and reported as MSL-F012 (info). ADR-015's byte-verbatim `astEquivalent` is
unchanged and still guards §5.2 body emission (MSL-F900).

Because a body is formatted dedented and re-indented afterward, the body pass
budgets its `lineWidth` at `80 − indent` (floor 20, via a per-call
`ProseFormatOptions.lineWidth` override) so a wrap point landing near column 80
dedented does not exceed 80 once re-indented — keeping the result in agreement
with a whole-file dprint view of the same content (e.g. the external dprint CLI
on this repo's own tree).

Idempotency (`format ∘ format === format`) is a tested hard requirement —
MSL-F010 depends on it.

## Consequences

- One-time reformat churn on existing projects (pre-1.0 no-migration policy);
  `check`'s MSL-F010 now covers prose drift.
- Deliberately-unformatted files use `project.yaml` `exclude:`.
- A future `@dprint/markdown` bump changes the canonical form — version bumps
  are release-notes-worthy events, pins are exact.
- Semantic line breaks (one sentence per line) do not survive
  `textWrap: always`.

## Amendment — configurable prose wrapping

**Context.** Corpora migrated from a requirements tool store each paragraph on
one line, and block editors change only the lines their author touched. Under
`textWrap: always`, a one-word edit near the start of a paragraph re-wraps every
following line once `markspec fmt` runs, so the diff of a requirement review
shows the whole paragraph changed. The opt-outs above do not scale:
`<!-- dprint-ignore -->` is per block, and `exclude:` also drops Id stamping and
trailer normalisation from the excluded files.

**Decision.** The prose wrapping becomes a project setting, in the
`.markspec.yaml` `format:` section (tool configuration, next to `exclude:` and
`caption-conventions:`):

```yaml
format:
  text-wrap: always # always | maintain | never — default always
```

The line width is not a MarkSpec key. It is the `.editorconfig`
`max_line_length` that applies to each formatted file, resolved per file as prim
and editors do (nested `.editorconfig` files and path-specific sections apply),
so one setting drives every formatter of a repository; without one, or with
`off`, it stays 80. Only `always` wraps to it. A `format.line-width` key is
refused with a pointer to `.editorconfig`. MarkDesk proposals use the width of
the project root's Markdown files.

`always` is the style above and stays the default, so existing projects do not
change unless their `.editorconfig` sets another width. `maintain` keeps the
author's line breaks; `never` joins each paragraph and list item onto one line.
Every other style rule stays fixed. The setting reaches dprint as a per-call
override, so one cached formatter serves every project. `fmt` uses the style of
each file's project, the `check` drift gate (MSL-F010) and the LSP use the same
one with the width of each file, MarkDesk uses the same wrapping with the width
of the project root's Markdown files, and the entry-body pass budgets
`line width − indent` (floor 20). An invalid value is a `MARKSPEC-YAML-003`
error.

**Invariants kept.** Idempotency holds for every value (tested), so MSL-F010
stays exact. The semantic-equivalence gate (MSL-F012) already treats soft-wrap
positions as equal and is unchanged. Hard breaks, tables, code, titles and
trailers are never re-wrapped.

**Consequences.** Switching a project's style reformats its prose once, as a
style change of its own. A project whose `.editorconfig` already gives Markdown
another `max_line_length` than 80, including through a generic `[*]` section,
fails `MSL-F010` after the upgrade until `markspec fmt` rewraps it once, as prim
already does. prim has no wrap mode: a repository that also runs `prim fmt` must
exclude the files formatted with `maintain` or `never` from prim
(`.primignore`), or the two formatters rewrap each other's output. Two projects
of one repository can use different styles; a file follows the project that owns
it. With `maintain`, wrapping is the author's responsibility; with `never`, long
lines rely on the editor's soft wrap. Semantic line breaks survive `maintain`.

**Alternatives considered.** A `.markspec.yaml` `line-width` key (rejected: a
second source of the width, which disagrees with prim's `.editorconfig` value);
a `project.yaml` key (rejected: `project.yaml` holds project metadata under a
closed schema; tool settings live in `.markspec.yaml`); a per-file directive
(does not scale to thousands of entries, same as `dprint-ignore`); making every
dprint option configurable (no demand, and it would fragment the canonical style
beyond wrapping).

## Alternatives considered

Delegating to an external dprint (violates one-binary expectation);
`remark-stringify` printing (cannot hard-wrap); whole-file dprint with per-file
fallback (fights the entry grammar); prose-only segmentation (leaves bodies
ragged, #649 unfixed).

## References

- Issue #649 — tables silently skipped by `markspec fmt`.
- [ADR-014](./adr-014-canonical-body-ast.md) — canonical body-AST and the
  formatter's string fallback this pass builds on.
- [ADR-015](./adr-015-ast-equivalence-formatting-contract.md) — the
  byte-verbatim `astEquivalent` contract (MSL-F900) this ADR leaves unchanged.
- [ADR-027](./adr-027-cli-smoother-defaults.md) — the composite `check` gate and
  `MSL-F010` this ADR extends to whole-document drift.
- As-built: `packages/markspec/core/formatter/dprint.ts` (WASM loader + fixed
  style), `packages/markspec/core/formatter/md_equiv.ts` (semantic equivalence
  gate), `packages/markspec/core/formatter/prose.ts` and `mod.ts`
  (segmentation + body pass + MSL-F012), `packages/markspec/lsp/server.ts`
  (`onDocumentFormatting`), `tests/e2e/format_test.ts` and
  `tests/e2e/lsp_formatting_test.ts`.
