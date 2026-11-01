---
id: gates
kind: guide
title: Gates
description: Block a change that breaks the graph with semspec check, an agent hook, a pre-commit hook and a CI step.
order: 8
related: [cli, profile, specs]
documents: [feat-harness, cap-gate, req-gate-check, req-gate-hooks, req-deliverables, req-spec-check]
---
The command `semspec check` reads the graph and the profile with the rules of `build`. It exits with a code that a hook or a CI step can use. The examples on this page are copies for your project. Semspec installs none of them.

## The check command

```
semspec check --graph <graph> --profile <profile> [--exclude <pattern>]... [--changed <file>...] [--json] [--strict]
semspec check --workspace <file> [--changed <file>...] [--json] [--strict]
```

The command reports 2 kinds of finding:

- A rule error. The profile, the graph, an edge, a vocabulary, a provenance field or a cross link breaks a rule. These are the problems that stop `build`.
- A gate finding. A gap that the profile lists in `gates.fail`.

The graph has no gate finding while it has a rule error, because its model is not reliable.

| Exit code | Meaning |
| --- | --- |
| 0 | No error. |
| 1 | At least 1 error. With `--strict`, a warning counts as an error. |
| 2 | A wrong use of the command, for example a missing option. |

Each finding takes 1 line, `<level> <file or node id>: <message>`. The level is `error` or `warning`. The lines are sorted: errors first, then by file or node id, then by message. A summary line ends the output, for example `check failed: 2 errors, 1 warning`. A message about a graph file names the file. A gate finding names the node id. With `--workspace`, a gate finding names `<graph id>:<node id>`.

`--json` prints 1 line of JSON: `{ "ok", "strict", "errors", "warnings", "findings" }`. Each finding has `level`, `subject` and `message`. A gate finding also has `gate`.

`--changed` limits the gate findings to the nodes of the listed files. A node that a profile makes from an object in another node (a part) belongs to the file of its owner. A rule error always counts. When the list holds the profile file or the workspace file, all gate findings count. `--changed` with no file gives only rule errors.

## Gates in the profile

The key `gates` of the profile lists the gap kinds that fail the check. A gap kind that the profile does not list never fails the check. The default is no gap kind.

```yaml
gates:
  fail: [unplaced, unresolved-link, no-source]
```

| Gap kind | A finding for |
| --- | --- |
| `bad-status` | A node whose own status has the tone `bad`. |
| `no-check` | A part with no check. |
| `no-source` | A node that needs a source and has none. The profile `provenance.source` and the roles `hierarchy` and `linked` decide this. |
| `unplaced` | A node of a kind with `placedUnder` that no parent field places under a node of that kind. |
| `unresolved-link` | A link that names a node that is not in the graph. Without this gate, the link is a warning. |
| `broken-cross-link` | A cross link that names a node that is not in the other graph of the workspace. |
| `missing-deliverable` | A node that misses a deliverable that the profile key `deliverables` states for its kind. One finding for each missing item. See [The profile](../reference/profile.md#deliverables). |

These are the same gaps as the MCP tool `gaps`. `semspec deliverables` lists the missing deliverables with no gate. In a workspace, each graph uses the `gates` of its own profile.

## Agent hook

A hook of Claude Code can run the check after each write to the graph folder and report the findings to the agent. Put the settings in `.claude/settings.json` of the project:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/semspec-check.sh" }]
      }
    ]
  }
}
```

The hook reads the tool call as JSON on stdin. This script, `.claude/hooks/semspec-check.sh`, needs `jq`. It ignores files outside the graph folder. On a finding it writes the lines to stderr and exits with code 2, which Claude Code returns to the agent:

```sh
#!/bin/sh
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  "$CLAUDE_PROJECT_DIR"/requirements/graph/*) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out=$(semspec check --graph requirements/graph --profile requirements/profile.yaml --changed "$file"); then
  echo "$out" >&2
  exit 2
fi
```

Change the graph folder and the profile path to your own. Make the script executable with `chmod +x`. The test suite of Semspec runs the script. It does not run Claude Code, so check the format of the settings against the current Claude Code hooks documentation before you rely on it.

## Pre-commit hook

A pre-commit hook blocks a commit that breaks the graph. Save this as `.githooks/pre-commit` and make it executable:

```sh
#!/bin/sh
exec semspec check --graph requirements/graph --profile requirements/profile.yaml --changed $(git diff --cached --name-only)
```

Tell git to use the folder:

```
git config core.hooksPath .githooks
```

The check reads the files of the working tree, not the staged content. A file name with a space does not work with this script. The command `semspec` must be in the `PATH` of the hook. With a local install, use `npx semspec` instead.

## CI step

This GitHub Actions workflow checks the graph on each push and pull request. Pin each action to a full commit SHA and write the version in a comment, as this repository does in its own workflow.

```yaml
name: Check
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full commit SHA> # v4
      - uses: actions/setup-node@<full commit SHA> # v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx semspec check --graph requirements/graph --profile requirements/profile.yaml
```

## Spec check in CI

A document that `semspec spec` fills can go stale when the graph changes. `semspec spec --check` writes nothing. It exits with 1 when a marked section differs from the graph, and it names the file, the line and the section. See [Markdown specs](specs.md).

Add a step after the graph check:

```yaml
      - run: npx semspec spec --graph requirements/graph --profile requirements/profile.yaml docs/requirements.md --check
```

To fix a failed step, run the same command without `--check` and commit the files that it changes. This repository does the same for `docs/reference/requirements.md`.
