# JUnit verification

Semspec can derive condition status from JUnit XML. Add `verification` to a profile that has `parts`, `checks` and `status`:

```yaml
verification:
  root: ../..
  record: ../../build/verification.json
  inputs: [src, tests, contracts, build.gradle.kts, settings.gradle.kts, gradle.properties, requirements]
  exclude: ["**/build/**", "**/.gradle/**"]
  classField: class
  methodField: method
```

`root` and `record` are relative to the profile file. The record must be inside `root`, outside report paths. It can be inside an excluded output directory of a declared input. It cannot replace an exact declared input or the profile. Each input and report path is relative to `root`. An absolute input can include an external contract. Every declared input must exist and contain a nonexcluded file. Inputs are files or recursive directories, without glob patterns. Fingerprint inputs and report files cannot be symlinks. The configured root can use a system path alias such as `/tmp`. Output files and their parents below the canonical root cannot be symlinks. Existing output files must be valid Semspec evidence. Preflight failure preserves prior evidence and inputs.

`exclude` is optional. Its patterns match paths relative to `root` with `/` separators. It uses the same matcher as graph folder exclusions: `*` matches within one segment, `**` matches across segments, and `?` matches one character. A plain name matches that file or directory name at any depth. Excluded directories are not traversed. For a multi-module build, declare module directories as inputs and exclude `**/build/**` and `**/.gradle/**`. This includes build scripts and future source additions without fingerprinting generated classes or caches. Exclusions cannot hide the profile or loaded graph. Every profile change still changes the fingerprint. Keep records and reports in output directories. Do not exclude source, tests, contracts or configuration files.

Declare all source, test, contract, build, dependency, configuration and graph inputs that can change the result. Include configuration files that select external fixtures. Semspec also fingerprints the profile itself. It requires the loaded graph to be inside an input. It cannot discover an omitted build dependency. Use the same input layout in each worktree. Fingerprints cover file contents, including uncommitted changes, rather than commit ids.

For every linked test, supply the fields that `classField` and `methodField` name. Use the JUnit `classname` and `name`. A package-qualified class is safest. A simple class matches only when the record contains one full class with that name. Semspec removes a final numeric repetition suffix such as `[1]` and an empty parameter list `()` when matching methods. It does not infer a Java method from a custom display name. Link the exact display name instead. Methods with parameter signatures keep their signature.

Snapshot the sources before running tests:

```sh
semspec test-record --profile requirements/profile.yaml --phase begin --junit build/test-results/test
# Run the tests here. Force the test runner to execute and refresh every selected report.
semspec test-record --profile requirements/profile.yaml --phase collect
semspec build --graph requirements/graph --profile requirements/profile.yaml --out build/requirements.html
```

Repeat `--junit` at begin for multiple report files or directories. Missing report directories are allowed at begin. Collection requires at least one report. It rejects an unchanged old report, a report older than the snapshot, and a source change during execution. Begin invalidates the previous record. The record and pending snapshot are excluded from the source fingerprint. Selecting a report path does not exclude its contents from fingerprints. A report path cannot contain the profile or any nonexcluded authored input. If a declared module input contains report output, exclude that generated output directory with `verification.exclude`.

Every load reads and checks the record and original XML again. Keep both with the source checkout. A content change makes the evidence stale. A report that changes, disappears or is added after collection also makes the evidence stale, with a warning. A test run or a clean of the build output does this. Run the tests and collect again. The integrity digest detects accidental record changes. It is not a signature and does not authenticate an untrusted producer. Use trusted test execution and retain its logs when provenance matters.

Each condition has `passed`, `failed` or `not-run`, plus a `stale` flag. Every named test must have at least one case and every matching repetition must pass. Any matching failure gives `failed`. Missing tests, skips, ambiguous class names and an empty test list give `not-run`. Stale evidence gives `not-run`. These outcomes map to the profile's good, bad and warn tones. Semspec ignores authored ancestor status values while verification is enabled. It writes no condition status to graph files. CLI, MCP and explorer loads use the same derived graph. The explorer shows the outcome and stale flag with each condition.

The XML reader supports JUnit `testsuite`, `testsuites`, `testcase`, `failure`, `error` and `skipped` elements. It rejects DTDs and custom entities. It checks declared suite and root counts against cases. It rejects nonzero suite `disabled` counts and testcase status attributes rather than treating them as passes. A zero-case report never proves a condition. This reports only the assertions that ran. An empty implementation can still pass a structural test; the test must exercise the behavior that the condition requires.
