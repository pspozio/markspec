# GitLab mirror validation

This configuration transposes the Linux validation jobs from
`.github/workflows/ci.yaml` to the enterprise GitLab runners. It builds MarkSpec
directly from the pipeline checkout, without SySo, STS, SEED or a preinstalled
MarkSpec binary.

## Deployment without changing the source branch

Keep this configuration on the dedicated `ci/gitlab-mirror` branch. In the
mirror project's **Settings > CI/CD > General pipelines > CI/CD configuration
file**, select:

```text
.gitlab/ci/mirror.yml@partners/alliance-car/sandbox/vibe/vibe-spec/markspec:<configuration-commit>
```

Replace `<configuration-commit>` with the full reviewed configuration commit.
The explicit project and immutable ref load the configuration independently of
the branch being tested. Do not merge this branch merely to enable CI: the
source branch and its existing commit identities remain unchanged. New
configuration revisions require an explicit update of the GitLab setting.

Push and merge-request pipelines validate their own checkout; web/API runs can
validate an existing branch without a source commit. Tags do not publish or
release anything through this configuration. The configuration branch itself can
also be tested without updating a consumer Gitlink.

## Coverage and evidence

The pipeline checks Deno and prim formatting, Deno/prim/shell lint, all five
TypeScript entry points, Linux tests, generated design tokens and the AST
fidelity matrix. Merge requests additionally check Conventional Commits. The
compile job uses the upstream `scripts/compile_binary.ts` wrapper, exercises the
compiled binary on Markdown and TypeScript/TSX inputs, and retains the binary,
smoke output and build evidence for one week. Validation exit codes 0 and 2 are
accepted only in the two upstream source-file smoke scenarios; other commands
retain their original failure behavior.

Tool releases have explicit versions and archive SHA-256 checks. The observed
build evidence records the source commit, immutable configuration reference,
pipeline, binary hash, dependency/grammar lock hashes and tool fingerprints.
Grammar downloads must match the tracked lock. Dependency resolution uses the
existing frozen Deno lock and the public npm registry; a registry or certificate
failure is a failed job, not permission to disable TLS checks. prim, which
formats and lints Markdown, JSON, YAML and TOML since MarkSpec 0.13, matches the
version pinned by the upstream `scripts/install_prim.sh`.

The first deployment covers Linux x86_64 only, with the six explicit PDF-test
exclusions described below. It does **not** replace the upstream Windows/macOS
test legs, PowerShell installer check, release, Pages, VSIX verification or
grammar-update workflows. No job is allowed to fail silently, and a green Linux
pipeline is not evidence of those missing checks. Consumer integration checks in
SySo and STS remain necessary.

The format and lint jobs run `prim fmt --check .` and `prim lint .`, the same
commands as the upstream `prim` job.

The enterprise Python image supplies transport and certificate configuration;
the jobs use the `kube` and `rswl` runner tags. Tools and dependency caches are
kept outside the source tree during validation to avoid discovering toolchain
files as MarkSpec sources. No corpus, acquisition or publication is performed.

Preserve the upstream default color behavior: the CLI help snapshots contain
ANSI styling, so forcing `NO_COLOR` changes the asserted output. Keep `DENO_DIR`
explicit for every job so subprocess tests overriding `HOME` reuse the verified
dependency cache rather than unexpectedly downloading into a fresh home
directory. Deno and Node use the system certificate authorities; TLS
verification remains enabled.

## Fork-line VSIX packaging and publication

On the STS/SySo fork line `feat/sts-markspec-integration` only, `package-vsix`
builds the VS Code extension for `linux-x64`, `darwin-x64`, `darwin-arm64` and
`win32-x64`, the platforms of the upstream release. The Linux runner
cross-compiles each `markspec` binary by passing `--target` to `deno compile`,
using the Deno 2.9.7 `denort` runtime of the target, downloaded from the Deno
release with a pinned SHA-256 (`DENORT_BIN`). The extension bundles that binary.
Each VSIX comes with a JSON evidence file recording the source commit, the
configuration reference, the pipeline, the target, the `denort` archive, and the
SHA-256 of the binary, the VSIX and the lock files. Both stay as job artifacts
for one week.

The extension version states that it is derived: the mirror's release version
followed by `-sts.N`, for example `0.12.0-sts.1`. `N` follows the highest
`-sts.N` already published for that release. The VSIX file name and its evidence
also record the fork-line commit.

`publish-vsix` is a manual job. Run it for the commit that SySo pins, when the
consumers repoint. It uploads the four VSIX and their evidence to the project's
generic package registry as `markspec-ide/<version>`, and it refuses a version
that is already published. The registry follows the project's visibility:
downloading requires at least the Reporter role on the project or on its group.
The macOS binaries are cross-compiled and unsigned. For a strict binary
identity, consumers keep the executable that their own CI builds and select it
with `markspec.server.path`.

## Enterprise PDF test limitation

The PDF tests import the bundled Typst package, which also imports
`@preview/touying:0.6.1` through its deck exports. Document-only tests therefore
need this package too. Pipeline `51453325` confirmed that downloading its
archive from the enterprise runner receives HTTP 403, including through Python's
HTTPS transport. This does not establish that the workstation's VPN causes the
runner's restriction.

On 2026-10-16, the workspace owner explicitly authorized excluding the affected
tests from this mirror's CI. On 2026-11-16, they extended the authorization to
the `doc build <file>` cross-file reference test added in MarkSpec 0.13 (#950),
which also builds a PDF. Only these six tests are excluded:

- `compileTypst: compiles with markspec-doc template`
- `compileTypst: compiles with cmarker`
- `doc build: produces PDF from Markdown`
- `doc build: output file has PDF magic bytes`
- `doc build: --output flag writes to custom path`
- `doc build <file>: a Satisfies target in another file reports no MSL-L006 (#950)`

The test sources remain unchanged. The three self-contained Typst compiler tests
still run, as does the rest of the suite; the upstream GitHub CI of the fork
runs all six excluded tests. The job logs every exclusion and checks the
complete test-name inventory of both affected modules; a new, renamed or
differently registered test blocks the job until the selection is reviewed. No
broad filename exclusion silently removes future tests.

This is an explicit coverage limitation, not a successful PDF integration
validation. It does not weaken the formatter, legacy fidelity, binary build,
type-check, lint or other test gates. No snapshot or TLS policy changes. The
failed archive-prefetch step is removed; restore the six tests after
establishing an authorized package-access route for the runners.

Track restoration and its acceptance criteria in
[MarkSpec #17](https://gitlabee.dt.renault.com/partners/alliance-car/sandbox/vibe/vibe-spec/markspec/-/issues/17).
Keep this issue open while any of these exclusions remain active.
