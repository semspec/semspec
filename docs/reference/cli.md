---
id: cli
kind: reference
title: Command line
description: The commands and options of the semspec command.
order: 1
related: [getting-started, yaml-folder, workspace, export, schemas, mcp, gates, meaning-search, specs]
documents: [req-build-info, req-serve, req-build-html, cap-validate, req-validate-graph, req-validate-profile, req-mcp-serve, req-search-keyword, req-gate-check, req-context-slice, req-deliverables, req-embed-provider, req-embed-index, req-embed-hybrid, req-spec-markers, req-spec-check, req-spec-default]
---
## Commands

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
semspec build --workspace <file> --out workspace.html
semspec mcp --graph <graph> --profile <profile> [--exclude <pattern>]...
semspec mcp --workspace <file>
semspec search --graph <graph> --profile <profile> "<query>" [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json] [--exclude <pattern>]...
semspec search --workspace <file> "<query>" [--in <graph>] [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json]
semspec index --graph <graph> --profile <profile> [--exclude <pattern>]...
semspec index --workspace <file>
semspec eval-search [--set <file>] [--workspace <file> | --graph <graph> --profile <profile>] [--mode keyword|hybrid|vector]
semspec slice --graph <graph> --profile <profile> <id> [--depth <n>] [--budget <n>] [--json] [--exclude <pattern>]...
semspec slice --workspace <file> <id> [--in <graph>] [--depth <n>] [--budget <n>] [--json]
semspec deliverables --graph <graph> --profile <profile> [--scope <id>] [--kind <kind>]... [--json]
semspec deliverables --workspace <file> [--in <graph>] [--scope <id>] [--kind <kind>]... [--json]
semspec spec --graph <graph> --profile <profile> <template.md>... [--check] [--json] [--exclude <pattern>]...
semspec spec --workspace <file> --out <dir> [--roots <kind,...>] [--glossary <graph id>] [--check] [--json]
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
- `index` embeds the nodes with the model of `search.embeddings` and writes the index files. See below.
- `eval-search` prints recall at 5 and MRR of the keyword and the hybrid search. See below.
- `slice` prints the brief for a task on 1 node. See below.
- `deliverables` lists the nodes that miss a deliverable of the profile. See below.
- `spec` fills the marked sections of Markdown templates from the graph, or writes default documents. See below.
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

## Deliverables

`semspec deliverables` lists the nodes that miss a deliverable of the profile key `deliverables`. See [The profile](profile.md#deliverables).

```
semspec deliverables --graph <graph> --profile <profile> [--scope <id>] [--kind <kind>]... [--json] [--exclude <pattern>]...
semspec deliverables --workspace <file> [--in <graph>] [--scope <id>] [--kind <kind>]... [--json]
```

| Option | Meaning |
| --- | --- |
| `--scope <id>` | Keep only the node and the nodes in its scope. |
| `--kind <kind>` | Keep only nodes of this kind. The option can repeat. A comma separates several kinds. |
| `--in <graph>` | With `--workspace`: report 1 graph. The default is all graphs. With `--scope`, the default is the first graph. |
| `--json` | Print `{ "nodes", "findings" }` as 1 line of JSON. A finding has `graph`, `node`, `kind`, `title`, `deliverable`, `item` and `message`. |
| `--exclude <pattern>` | As for `build`. |

Each finding takes 1 line, `<node id>: <message>`. A workspace finding has the graph id before the node id. A summary line ends the output. The command exits with 0, or with 1 and a message on stderr when an input or an option is not valid. A missing deliverable does not change the exit code. To fail on it, list `missing-deliverable` in `gates.fail` and run `semspec check`.

## Slice

`semspec slice` prints the brief for a task on 1 node: the node, its path to the root, its parts and checks, its linked nodes, its cross links with their definitions, the definitions of its coded values, its gaps, its missing deliverables and the nodes below it. The content and the budget rules are those of the MCP tool `slice`. See [MCP server](mcp.md).

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

## Spec

`semspec spec` writes Markdown specification documents from the graph. The author owns the document, and Semspec owns its marked sections. See [Markdown specs](../guide/specs.md) for the markers, the options and the shapes.

| Option | Meaning |
| --- | --- |
| `<template.md>...` | Template files. The command fills their marked sections and rewrites each file in place. A file that has no change stays as it is. |
| `--out <dir>` | Write default documents into the folder, in place of template files. A file that exists keeps its text, and only its marked sections change. |
| `--roots <kind,...>` | With `--out`: the kinds of the root nodes. The default is `spec.roots` of the profile. Each node of these kinds gets a document with a tree section and a traceability section. |
| `--glossary <graph id>` | With `--out`: also write a glossary document for this graph. |
| `--check` | Write nothing. Exit with 1 and name the file, the line and the section when a section is stale or an author changed it. Exit with 0 when all sections match the graph. |
| `--json` | Print `{ "ok", "findings", "written", "sections" }` as 1 line of JSON. A finding has `code` (`error` or `stale`), `file`, `line`, `section` and `message`. |
| `--exclude <pattern>` | As for `build`. |

The command exits with 0, with 1 when a section is stale (with `--check`), when a template has an error or when a file cannot be read, and with 2 when the options are wrong. An error names the file and the line, as `docs/spec.md:12: Unknown option "colour".`. When one section has an error, the command writes no file.

```
semspec spec --graph requirements/graph --profile requirements/profile.yaml docs/requirements.md
semspec spec --graph requirements/graph --profile requirements/profile.yaml docs/requirements.md --check
```

## Search

`semspec search` finds nodes by words. The words that are not an option make the query. The ranking and the synonyms are those of the MCP tool `search`. See [MCP server](mcp.md).

| Option | Meaning |
| --- | --- |
| `--kind <kind>` | Keep only nodes of this kind. The option can repeat. A comma separates several kinds. |
| `--scope <id>` | Keep only nodes in the scope of this node. |
| `--in <graph>` | With `--workspace`: search 1 graph. The default is all graphs. |
| `--limit <n>` | The most hits. The default is 50. |
| `--mode <mode>` | `keyword`, `hybrid` or `vector`. The default is `hybrid` when the graph has an index of vectors, and `keyword` when it has none. See [Meaning search](../guide/meaning-search.md). |
| `--json` | Print the result as 1 line of JSON, as the MCP tool does, with `omitted` in place of `truncated`. |

Each hit takes 2 lines: the rank, the id, the kind, the title, the parent and the status, then the snippet with the matched words in `**`. A workspace hit has the graph id before the node id. A line at the end gives the count of hits that the limit cuts. A query with no match prints `No node matches "<query>".` and exits with code 0. A wrong option or an unknown kind writes a message to stderr and exits with code 1.

When the model of the meaning search does not answer, the search uses keywords only. The text output then ends with a line `note: <reason>`, and the JSON has a `notes` list.

## Index

`semspec index` embeds the text of each node with the model that `search.embeddings` names, and writes one index file for each graph. It needs the setting in the workspace file or in the profile. Without a setting, it prints a message and exits with code 1. A rerun embeds only the new nodes and the nodes whose text changed, and drops the removed nodes. A change of the model, `dimensions` or a prefix embeds all nodes again. Each line of the output gives the graph id, the counts of embedded, kept and removed nodes, and the path of the index file. See [Meaning search](../guide/meaning-search.md).

## Eval-search

`semspec eval-search` runs a set of questions and prints recall at 5 and the mean reciprocal rank (MRR). With no `--mode`, it prints the `keyword` line and the `hybrid` line. It uses the model of the configuration, so run `semspec index` first. The npm script `npm run eval:search -- <options>` runs it in this repository.

| Option | Meaning |
| --- | --- |
| `--set <file>` | A YAML file with `questions`, each with `q` and the `expect` node ids. The default is `requirements/search-eval.yaml`. |
| `--workspace <file>`, or `--graph <file>` and `--profile <file>` | The graphs to search. The default is the graphs that the set names. |
| `--mode <mode>` | Run 1 mode only. |

## Opt-ins for the meaning search

`search`, `index`, `eval-search` and `mcp` accept 2 flags with no value. `--allow-command` lets a `command` provider run. `--allow-remote` lets Semspec send node texts to an endpoint that is not a loopback address. The environment variables `SEMSPEC_ALLOW_COMMAND=1` and `SEMSPEC_ALLOW_REMOTE=1` do the same. A file in the repository cannot give them, so a cloned repository cannot run a command or send text to a remote host by itself. Without the opt-in, `search` uses keywords only with a note, and `index` and `eval-search` exit with code 1. See [Meaning search](../guide/meaning-search.md).
