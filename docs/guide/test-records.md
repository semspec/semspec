---
id: test-records
kind: guide
title: Test evidence
description: Derive the status of the conditions from test reports, with adapters for JUnit XML and Vitest JSON.
order: 16
related: [gates, profile]
documents: [req-test-record, cap-evidence]
---

Semspec derives the status of a condition from test reports. A report format connects through an adapter. The adapter reads one format and gives results. Semspec joins the results to the checks of the conditions with a key rule.

Add `evidence` to a profile that has `parts`, `checks` and `status`:

```yaml
evidence:
  root: ../..
  record: ../../build/evidence.json
  inputs: [src, tests, contracts, requirements]
  exclude: [build, node_modules]
  fallback: not-run
  adapters:
    - adapter: junit
      reports: [build/test-results/test]
      checkTypes: [unit]
      key: { rule: class-method, class: class, method: method }
    - adapter: vitest-json
      reports: [build/vitest.json]
      checkTypes: [web]
      key: { rule: file-titlepath, file: file, name: name, separator: " > " }
```

## Settings

| Setting | Meaning |
| --- | --- |
| `root` | The base of `inputs` and of the report paths. It is relative to the profile file. |
| `record` | The sealed record file. It is relative to the profile file and inside `root`. |
| `inputs` | Files and folders, relative to `root`, that the fingerprint covers. |
| `exclude` | Patterns of paths that the fingerprint skips. |
| `fallback` | What a load gives when the evidence is stale or absent. `not-run` (the default) makes every condition not-run. `authored` keeps the authored status and writes a warning. |
| `adapters` | One entry for each report format. |

Each adapter entry has these settings:

| Setting | Meaning |
| --- | --- |
| `adapter` | `junit` or `vitest-json`. |
| `reports` | Report files or folders, relative to `root`. The adapter reads the files with its extension: `.xml` or `.json`. |
| `checkTypes` | The check types that the adapter answers. Without it, the adapter answers every check type. A check of a type that no adapter answers is not-run. |
| `key` | The key rule. |

The shared settings (`record`, `root`, `inputs`, `exclude`, `fallback`) are at the level of `evidence`, because the fingerprint and the record cover all adapters.

## Key rules

A key rule joins a check to the results of its adapter. The rule names the check fields that hold the parts of the key. A field that the rule leaves out has the name of its part.

| Rule | Check fields | Result key |
| --- | --- | --- |
| `class-method` | `class`, `method` | The class and the method of the test. |
| `file-name` | `file`, `name` | The file and the title of the test. The title has no group titles. |
| `file-titlepath` | `file`, `name` | The file and the title path. `name` holds the whole path. |

A title path joins the titles of the groups and of the test with the `separator` of the rule. The default is ` > `. The adapter builds the path from the list of titles, so a title can contain the separator.

Matching follows these rules:

- Both parts must be equal. A simple class name matches a full class name only when the results hold exactly one class with that name. Semspec removes a final repetition suffix such as `[1]` and an empty parameter list `()` from a JUnit method.
- A file path in a check matches a result path that ends with it. Two different result paths that end the same way are ambiguous and give not-run.
- Repeated cases count together. A failure wins. All cases must pass for a pass. A skipped case, a missing case and an ambiguous name give not-run.
- A condition passes when all its checks pass. A failed check fails the condition. A condition with no check is not-run.
- When two adapters answer the same check type, a failure wins. A pass needs at least one pass and no vote of not-run from an adapter that found the test.

## Authored status and derived status

The graph file keeps the authored `status` of a condition. The load adds the derived status to the condition, with the outcome (`passed`, `failed` or `not-run`) and the `stale` flag. Stale evidence gives not-run for every condition. The outcomes map to the good, bad and warn tones of the profile.

With derived evidence, the roll-up, the gates, the count of verified parts and the default display use the derived status. A node above the conditions has no status of its own, so its status comes from the conditions below it. The details panel shows both statuses when they differ. The model and the MCP tool `get` give `authoredStatus` and `derivedStatus`. The graph file is never edited.

`semspec coverage` counts both statuses, counts the conditions where they differ, and counts the stale conditions apart. `--list differ` and `--list stale` name the conditions. `--status-source authored|derived` (MCP input `statusSource`) selects the status that the filters, the groups, the counts and the gate use.

## Collection

Snapshot the sources before running the tests:

```sh
semspec test-record --profile requirements/profile.yaml --phase begin
# Run the tests here. Force the test runner to execute and refresh every selected report.
semspec test-record --profile requirements/profile.yaml --phase collect
semspec build --graph requirements/graph --profile requirements/profile.yaml --out build/requirements.html
```

Begin reads the report paths from `reports` of the adapters. `--junit <path>` adds a path for the first JUnit adapter. Missing report directories are allowed at begin. Collection requires at least one report. It rejects an unchanged old report, a report older than the snapshot, and a source change during execution. Begin invalidates the previous record. The record and the pending snapshot are not part of the fingerprint. A report path cannot contain the profile or any nonexcluded authored input.

`root` and `record` are relative to the profile file. The record can be inside an excluded output directory of a declared input. It cannot replace an exact declared input or the profile. Every declared input must exist and contain a nonexcluded file. Inputs are files or recursive directories, without glob patterns. Fingerprint inputs and report files cannot be symlinks. Output files and their parents below the canonical root cannot be symlinks. Existing output files must be valid Semspec evidence. A failed preflight keeps the previous evidence and the inputs.

`exclude` patterns match paths relative to `root` with `/` separators. They use the same matcher as the exclusions of a graph folder: `*` matches within one segment, `**` matches across segments, and `?` matches one character. A plain name matches that file or directory name at any depth. Excluded directories are not traversed. Exclusions cannot hide the profile or the loaded graph. Do not exclude source, tests, contracts or configuration files.

Declare all source, test, contract, build, dependency, configuration and graph inputs that can change the result. Semspec also fingerprints the profile. It requires the loaded graph to be inside an input. It cannot discover an omitted build dependency. Fingerprints cover file contents, including uncommitted changes, rather than commit ids.

## Stale evidence

Every load reads the record and the reports again. A content change of an input makes the evidence stale. A report that changes, disappears or is added after collection also makes the evidence stale, with a warning. A test run or a clean of the build output does this. Run the tests and collect again.

A record of an unknown version makes the evidence stale with a warning. A record of version 1, which holds JUnit cases, still loads. When the evidence cannot load for another reason, `semspec check` reports the error. The MCP server and the read commands (search, slice, spec, deliverables) still start. They write a warning, and every condition is not-run.

The integrity digest detects accidental record changes. It is not a signature and does not authenticate an untrusted producer. Use trusted test execution and retain its logs when provenance matters.

## The key `verification`

The profile key `verification` stays valid. It is the alias for one JUnit adapter with the key rule `class-method`:

```yaml
verification:
  root: ../..
  record: ../../build/verification.json
  inputs: [src, tests]
  classField: class
  methodField: method
```

A profile has `verification` or `evidence`, not both.

## Adapters

### junit

The adapter reads the XML of JUnit, of node test with the JUnit reporter (`node --test --test-reporter=junit`), of cargo nextest, and of the JUnit reporters of Playwright and Vitest. It reads `testsuite`, `testsuites`, `testcase`, `failure`, `error` and `skipped` elements. A `testcase` can be a child of `testsuites`, as node test writes a case of the top level. The adapter rejects DTDs and custom entities. It checks the declared counts of suites against the cases. It rejects nonzero suite `disabled` counts and testcase status attributes rather than treating them as passes.

A result has these key parts:

| Key part | Value |
| --- | --- |
| `class` | The `classname` of the case. |
| `method` | The `name` of the case. |
| `name` | The `name` of the case. |
| `file` | The `file` attribute, made relative to `root`. Without it, the `classname` when it is a source file path. Playwright writes the project before the file: `[chromium] › cart.spec.ts`. |
| `titlePath` | The `name` split at ` › ` or ` > ` when it holds them. Otherwise the names of the enclosing `testsuite` elements that are no file paths, and the `name`. |

### vitest-json

The adapter reads the report of `vitest run --reporter=json --outputFile=<path>`. A test has the file (`name` of the file result), the group titles (`ancestorTitles`) and its own `title`. The key holds `file` (relative to `root`), `name` (the title) and `titlePath` (the group titles and the title, joined with the separator). The status `passed` is passed and `failed` is failed. The statuses `skipped`, `pending` and `todo` are not-run. A file that failed to load has no cases, so its conditions are not-run, and a warning names the file.

## A report of a zero-case run

A zero-case report never proves a condition. The evidence reports only the assertions that ran. An empty implementation can still pass a structural test. The test must exercise the behavior that the condition requires.

## The repository of Semspec

The profile `requirements/profile.yaml` reads the Vitest JSON report `dist/vitest.json`. The checks of the conditions name a test by its file and title, so the key rule is `file-name`. The setting `fallback: authored` keeps the authored status when the evidence is stale or absent, so the site and the spec document do not change on a machine that has not run the tests. Run the tests and collect the record with:

```sh
npm run test:evidence
node bin/semspec.js coverage --graph requirements/graph --profile requirements/profile.yaml --list differ
```

The report lists the conditions whose derived status differs from the authored status.
