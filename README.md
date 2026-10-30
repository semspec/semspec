# Semspec

AI-native requirements engineering harness.

Semspec turns requirements that a project keeps as YAML or JSON into a typed, linked graph. It shows how each requirement traces to its parts, its checks and its status. A profile defines the kinds, the edges and the fields, so the same tool works for any project and any vocabulary.

What Semspec does today:

- It reads a folder of YAML files (1 file for each node), a YAML file or a JSON file. `--exclude` skips other folders.
- A graph folder can also hold Markdown pages with YAML front matter, when the profile sets `source.markdown`. A wiki, docs, ADRs or RFCs can be a graph.
- A profile defines kinds, edges, parts and checks. It also defines a status with a roll-up from the nodes below (good, warn, bad), and filters on any list field.
- You explore the graph with a hierarchy tree, a scope by any node, a walk of the graph by expansion, and Graph, Cards and Table views with a details panel.
- A status colour mode colours the graph by status. Filters select nodes by status and by profile fields. The table exports to CSV.
- `semspec schema` writes a JSON Schema for each kind, so editors and agents can check the YAML files.
- `serve` runs a live local page. `build` writes 1 self-contained HTML file.
- A workspace holds several graphs, each with its own profile, on 1 page. A node of 1 graph can link to a node of another graph.
- `semspec export` writes a graph or a workspace as RDF (Turtle, JSON-LD), as SHACL shapes or as a Cypher script.

The tool knows no project. Every kind, edge, field, colour and label comes from the profile.

## Install

Semspec is not on npm yet. Install it from GitHub:

```
npm install --save-dev github:semspec/semspec
```

The install builds the tool. The lockfile keeps the commit. It needs Node 20 or later.

## Contents

- `packages/core`: the pure logic (model, scope, walk, casing, CSV, export). The npm package `@semspec/core`.
- `packages/app`: the browser app.
- `packages/cli`: the command line tool.
- `schema`: the JSON Schemas of the graph, the profile and the workspace file.
- `fixtures`: the test graphs and profiles.
- `requirements`: the requirements of Semspec, as a Semspec graph.
- `docs`: the documentation, 1 Markdown page for each topic.
- `site`: the web site semspec.dev.

## Example

```
semspec build --graph <graph> --profile <profile> --out explorer.html
semspec serve --graph <graph> --profile <profile>
```

## Documentation

Read the documentation at https://semspec.dev/docs/ or in the [`docs/`](docs/) folder.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
