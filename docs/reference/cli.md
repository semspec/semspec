---
id: cli
kind: reference
title: Command line
description: The commands and options of the semspec command.
order: 1
related: [getting-started, yaml-folder, workspace, export, schemas, mcp, gates]
documents: [req-build-info, req-serve, req-build-html, cap-validate, req-validate-graph, req-validate-profile, req-mcp-serve, req-search-keyword, req-gate-check, req-context-slice]
---
## Commands

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
semspec build --workspace <file> --out workspace.html
semspec mcp --graph <graph> --profile <profile> [--exclude <pattern>]...
semspec mcp --workspace <file>
semspec search --graph <graph> --profile <profile> "<query>" [--kind <kind>]... [--scope <id>] [--limit <n>] [--json] [--exclude <pattern>]...
semspec search --workspace <file> "<query>" [--in <graph>] [--kind <kind>]... [--scope <id>] [--limit <n>] [--json]
semspec slice --graph <graph> --profile <profile> <id> [--depth <n>] [--budget <n>] [--json] [--exclude <pattern>]...
semspec slice --workspace <file> <id> [--in <graph>] [--depth <n>] [--budget <n>] [--json]
semspec check --graph <graph> --profile <profile> [--exclude <pattern>]... [--changed <file>...] [--json] [--strict]
semspec check --workspace <file> [--changed <file>...] [--json] [--strict]
semspec schema --profile <profile> --out <dir>
semspec export --graph <graph> --profile <profile> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec export --workspace <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec --version
semspec version --json
```

- `serve` starts a server on localhost. It reads both inputs again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.
- The page has a Light, Dark and System switch in the header. It keeps the choice in the browser storage of the viewer.
- `mcp` serves the graph or the workspace to an AI agent over the Model Context Protocol on stdio. See [MCP server](mcp.md).
- `check` validates the inputs and the gates of the profile, and exits with a code for a hook or a CI step. See below.
- `search` ranks the nodes for the query and prints the hits. See below.
- `slice` prints the brief for a task on 1 node. See below.
- `schema` writes 1 JSON Schema for each kind of the profile. See [The schemas of the kinds](schemas.md).
- `export` writes the graph for other tools. See [Export](export.md).
- `semspec --version` (or `-v`) prints `semspec <version> (<commit>)`, with ` dirty` after the commit when the tree was dirty at build time. `semspec version --json` prints `{ "name", "version", "commit", "dirty" }`. The page has the same text in `<meta name="generator">`.

`<graph>` is a JSON file, a YAML file or a folder of YAML files. `<profile>` is a JSON file or a YAML file (`.yaml` or `.yml`).

`--exclude` skips paths of a graph folder. It can repeat. See [The YAML folder](../guide/yaml-folder.md).

`--workspace` reads a workspace file instead of `--graph` and `--profile`. See [Workspace](../guide/workspace.md). It cannot combine with `--graph`, `--profile` or `--exclude`.

`serve`, `build` and `mcp` check the 2 inputs first and stop with a message when an input is not valid. A message about a YAML node names its file. `mcp` writes the message to stderr and exits with code 1.

## Check

`semspec check` reads the graph, or all graphs of a workspace, with the rules of `build`. It also fails on the gaps that the profile key `gates.fail` lists. See [Gates](../guide/gates.md) for the gap kinds, the hooks and a CI example.

| Option | Meaning |
| --- | --- |
| `--exclude <pattern>` | As for `build`. The option can repeat. |
| `--changed <file>...` | Keep only the gate findings of the nodes in these files. A rule error always counts. The option takes all values up to the next option, and can take none. |
| `--json` | Print the findings as 1 line of JSON. |
| `--strict` | A warning also fails the check. |

Each finding takes 1 line, `<level> <file or node id>: <message>`, sorted, and a summary line ends the output. The exit code is 0 when the check finds no error, 1 when it finds an error, and 2 for a wrong use of the command.

## Slice

`semspec slice` prints the brief for a task on 1 node: the node, its path to the root, its parts and checks, its linked nodes, its cross links with their definitions, the definitions of its coded values, its gaps and the nodes below it. The content and the budget rules are those of the MCP tool `slice`. See [MCP server](mcp.md).

| Option | Meaning |
| --- | --- |
| `<id>` | Required. The node id. |
| `--in <graph>` | With `--workspace`: the graph of the node. The default is the first graph. |
| `--depth <n>` | The levels of nodes below the node, from 1 to 5. The default is 1. |
| `--budget <n>` | The approximate size of the text in characters. The default is 6000. |
| `--json` | Print the slice as 1 line of JSON in place of Markdown. |
| `--exclude <pattern>` | As for `build`. |

The command exits with 0, or with 1 and a message on stderr when the node, the graph or an option is not valid.

```
semspec slice --graph requirements/graph --profile requirements/profile.yaml req-mcp-check-tools
```

## Search

`semspec search` finds nodes by words. The words that are not an option make the query. The ranking and the synonyms are those of the MCP tool `search`. See [MCP server](mcp.md).

| Option | Meaning |
| --- | --- |
| `--kind <kind>` | Keep only nodes of this kind. The option can repeat. A comma separates several kinds. |
| `--scope <id>` | Keep only nodes in the scope of this node. |
| `--in <graph>` | With `--workspace`: search 1 graph. The default is all graphs. |
| `--limit <n>` | The most hits. The default is 50. |
| `--json` | Print the result as 1 line of JSON, as the MCP tool does, with `omitted` in place of `truncated`. |

Each hit takes 2 lines: the rank, the id, the kind, the title, the parent and the status, then the snippet with the matched words in `**`. A workspace hit has the graph id before the node id. A line at the end gives the count of hits that the limit cuts. A query with no match prints `No node matches "<query>".` and exits with code 0. A wrong option or an unknown kind writes a message to stderr and exits with code 1.
