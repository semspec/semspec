---
id: agent-context
kind: guide
title: Agent context
description: Give an agent the brief for a task with slice, and let it use validate and check around each change.
order: 9
related: [mcp, cli, gates]
documents: [feat-harness, cap-slice, req-context-slice, req-deliverables]
---
An agent that works from a requirement graph needs 3 things: the context of its task, a check of each node it writes, and a check of the graph before it commits. Semspec gives each one as a tool of the MCP server and as a command.

| Step | MCP tool | Command |
| --- | --- | --- |
| Start of a task | `slice` | `semspec slice` |
| Know when it is done | `gaps`, `slice` | `semspec deliverables` |
| Before a write | `validate` | none |
| Before a commit | none | `semspec check` |

## Start a task with slice

The tool `slice` returns 1 brief for a node. The brief holds what the agent needs to start:

- the statement, fields, lifecycle and status of the node,
- the path to the root,
- the parts of the node, each with its status and checks, and the parts that have no check,
- the nodes that govern it, such as decisions, rules and standards, with their notes,
- the nodes of other graphs that it links to, with their definitions,
- the definitions of the coded values that it uses,
- the deliverables that the profile states for the kind of the node, and the ones that are missing,
- the gaps, and the nodes below it.

The agent calls it with the id of the task node:

```
slice { "id": "story-pay-by-card", "graph": "req" }
```

The brief is Markdown. The ids are in backticks, so the agent can pass them to `get`, `walk` or `impact`. With `format` set to `json`, the tool returns the same data as JSON.

The `budget` limits the size. The default is 6000 characters. When the brief is longer, the tool drops the deep children first, then the long statements of linked nodes, and it names each cut at the end of the brief. When the agent needs a cut part, it asks for it with another tool, for example `get` or `trace`. With `depth` above 1, the brief lists more levels of nodes below the node.

From the command line, a person or a script gets the same brief:

```
semspec slice --workspace workspace.json --in req story-pay-by-card
```

See [MCP server](../reference/mcp.md) and [Command line](../reference/cli.md) for all inputs.

## Know when the task is done

The profile key `deliverables` states what a task on a node of each kind must deliver, for example at least 1 part, a check for each part, a status, fields or links. The brief lists each missing deliverable of the node and its parts. The task is done when the list is empty. The tool `gaps` gives the same list for a scope, and `semspec deliverables` gives it from the command line. See [The profile](../reference/profile.md#deliverables).

To block a commit while a deliverable is missing, list `missing-deliverable` in `gates.fail`. See [Gates](gates.md).

## Validate before a write

Before the agent writes a node, it calls `validate` with the node as YAML or JSON text. The tool checks the node against the profile as if it were in the graph. It writes nothing. The answer lists the errors and the warnings that the new node adds, for example an unknown kind, a wrong link, a code that is not in a vocabulary, or a missing source. The agent fixes the node and calls `validate` again until `valid` is true. Then it writes the file.

## Check before a commit

Before a commit, the agent runs `semspec check`. The command fails on a rule error and on the gaps that the profile lists in `gates.fail`. See [Gates](gates.md) for the exit codes, the agent hook, the pre-commit hook and the CI step. The agent fixes each finding and runs the command again.

## Sample instructions for an agent

Copy this block into the `CLAUDE.md` or the `AGENTS.md` of your project. Change the paths and the graph ids.

```markdown
## Requirements

The requirements of this project are a graph in `requirements/graph`. The profile is `requirements/profile.yaml`. The MCP server `semspec` serves them.

- At the start of a task on a requirement, call the tool `slice` with its id. Read the brief before you plan.
- Use `search` to find the requirement when you have only words. Use `walk` and `impact` to see what links to a node.
- Follow the decisions, rules and standards in the brief. When a task conflicts with one of them, stop and ask.
- Before you write or change a node, call `validate` with the node. Fix each error. Fix each warning, or say why you keep it.
- Write only YAML files in `requirements/graph`. Keep one node in one file.
- When your change makes a condition true, set its status and link the test in the same change.
- A task on a node is done when the section Deliverables of its brief says `All delivered.`
- Before each commit, run `npx semspec check --graph requirements/graph --profile requirements/profile.yaml`. Do not commit while it reports an error.
```
