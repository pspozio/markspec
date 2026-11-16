import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { readLineWidth, readMarkdownLineWidth } from "./editorconfig.ts";

const ROOT = resolve("/repo");

function reader(files: Record<string, string>) {
  return (path: string) => Promise.resolve(files[path]);
}

Deno.test("readMarkdownLineWidth: a nearer file overrides a farther one", async () => {
  const project = join(ROOT, "specs");
  const result = await readMarkdownLineWidth(
    project,
    reader({
      [join(ROOT, ".editorconfig")]:
        "root = true\n[*.md]\nmax_line_length = 80\n",
      [join(project, ".editorconfig")]: "[*.md]\nmax_line_length = 120\n",
    }),
  );
  assertEquals(result, {
    value: "120",
    source: join(project, ".editorconfig"),
  });
});

Deno.test("readMarkdownLineWidth: root = true stops the upward search", async () => {
  const project = join(ROOT, "specs");
  const result = await readMarkdownLineWidth(
    project,
    reader({
      [join(ROOT, ".editorconfig")]: "[*.md]\nmax_line_length = 120\n",
      [join(project, ".editorconfig")]:
        "root = true\n[*.ts]\nindent_size = 2\n",
    }),
  );
  assertEquals(result, {});
});

Deno.test("readMarkdownLineWidth: globs follow EditorConfig semantics", async () => {
  const project = join(ROOT, "docs");
  const width = async (section: string) =>
    (await readMarkdownLineWidth(
      project,
      reader({
        [join(ROOT, ".editorconfig")]:
          `root = true\n[${section}]\nmax_line_length = 100\n`,
      }),
    )).value;
  assertEquals(await width("*"), "100");
  assertEquals(await width("*.md"), "100");
  assertEquals(await width("*.{md,markdown}"), "100");
  assertEquals(await width("docs/*.md"), "100");
  assertEquals(await width("**.md"), "100");
  assertEquals(await width("other/*.md"), undefined);
  assertEquals(await width("*.ts"), undefined);
});

Deno.test("readMarkdownLineWidth: comments and later sections", async () => {
  const result = await readMarkdownLineWidth(
    ROOT,
    reader({
      [join(ROOT, ".editorconfig")]:
        "# top\nroot = true\n\n[*]\n; all files\nmax_line_length = 120\n\n[*.md]\nmax_line_length = 80\n",
    }),
  );
  assertEquals(result.value, "80");
});

Deno.test("readLineWidth: resolves each file, nested files and path sections", async () => {
  const docs = join(ROOT, "docs");
  const files = reader({
    [join(ROOT, ".editorconfig")]:
      "root = true\n[*.md]\nmax_line_length = 100\n[docs/**.md]\nmax_line_length = 110\n[a.md]\nmax_line_length = 90\n",
    [join(docs, "deep", ".editorconfig")]: "[*.md]\nmax_line_length = 120\n",
  });
  const width = async (path: string) =>
    (await readLineWidth(path, files)).value;
  assertEquals(await width(join(ROOT, "x.md")), "100");
  assertEquals(await width(join(ROOT, "a.md")), "90");
  assertEquals(await width(join(docs, "x.md")), "110");
  assertEquals(await width(join(docs, "deep", "x.md")), "120");
});

Deno.test("readLineWidth: glob features", async () => {
  const width = async (section: string, file: string) =>
    (await readLineWidth(
      join(ROOT, file),
      reader({
        [join(ROOT, ".editorconfig")]:
          `root = true\n[${section}]\nmax_line_length = 100\n`,
      }),
    )).value;
  assertEquals(await width("?.md", "a.md"), "100");
  assertEquals(await width("?.md", "ab.md"), undefined);
  assertEquals(await width("[ab].md", "b.md"), "100");
  assertEquals(await width("[!ab].md", "b.md"), undefined);
  assertEquals(await width("[!ab].md", "c.md"), "100");
  assertEquals(await width("/x.md", "x.md"), "100");
  assertEquals(await width("/x.md", "sub/x.md"), undefined);
  assertEquals(await width("**/x.md", "sub/x.md"), "100");
  assertEquals(await width("{a,b}.md", "sub/b.md"), "100");
  assertEquals(await width("ch{1..3}.md", "ch2.md"), "100");
  assertEquals(await width("ch{1..3}.md", "ch4.md"), undefined);
  assertEquals(await width("\\*.md", "*.md"), "100");
});

Deno.test("readLineWidth: a malformed glob is ignored instead of throwing", async () => {
  for (const section of ["{foo", "[z-a].md", "*.{md"]) {
    const result = await readLineWidth(
      join(ROOT, "x.md"),
      reader({
        [join(ROOT, ".editorconfig")]:
          `root = true\n[*.md]\nmax_line_length = 90\n[${section}]\nmax_line_length = 100\n`,
      }),
    );
    assertEquals(result.value, "90", section);
  }
});
