# Semspec

AI-native requirements engineering harness.

Semspec turns requirements that a project keeps as YAML or JSON into a typed, linked graph. It shows how each requirement traces to its parts, its checks and its status. A profile defines the kinds, the edges and the fields, so the same tool works for any project and any vocabulary.

What Semspec does today:

- It reads a folder of YAML files (1 file for each node), a YAML file or a JSON file. `--exclude` skips other folders.
- A profile defines kinds, edges, parts and checks. It also defines a status with a roll-up from the nodes below (good, warn, bad), and filters on any list field.
- You explore the graph with a hierarchy tree, a scope by any node, a walk of the graph by expansion, and Graph, Cards and Table views with a details panel.
- A status colour mode colours the graph by status. Filters select nodes by status and by profile fields. The table exports to CSV.
- `semspec schema` writes a JSON Schema for each kind, so editors and agents can check the YAML files.
- `serve` runs a live local page. `build` writes 1 self-contained HTML file.

The tool knows no project. Every kind, edge, field, colour and label comes from the profile.

## Use

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
semspec schema --profile <profile> --out <dir>
```

- `serve` starts a server on localhost. It reads both inputs again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.
- `schema` writes 1 JSON Schema for each kind of the profile. See "The schemas of the kinds".

`<graph>` is a JSON file, a YAML file or a folder of YAML files. `<profile>` is a JSON file or a YAML file (`.yaml` or `.yml`).

`--exclude` skips paths of a graph folder. It can repeat. See "The YAML folder".

`serve` and `build` check the 2 inputs first and stop with a message when an input is not valid. A message about a YAML node names its file.

## The YAML folder

A folder can hold the graph, with 1 file for each node. The folder can have sub-folders, for example 1 for each kind:

```
requirements/
  epic/epic-checkout.yaml
  story/story-pay-by-card.yaml
```

- Semspec reads every `*.yaml` and `*.yml` file below the folder, in sorted order of the path.
- A file that holds a mapping is 1 node. A file that holds a list of mappings is several nodes.
- The graph is `{ "<source.nodes>": [ ...the nodes... ] }`. The profile names the key in `source.nodes`.
- A single YAML file can also hold a whole graph, in the same shape as a JSON graph.
- `serve` reads the folder again on each page load, so an edit shows on reload.

A graph folder can sit next to folders that hold YAML but no nodes, for example `schema/` or `generated/`. Skip them with `--exclude`:

```
semspec build --graph requirements --profile profile.yaml --out explorer.html --exclude schema --exclude 'generated/**'
```

- A pattern matches a path relative to the graph folder, with `/` as separator.
- `*` matches any characters except `/`. `**` matches any characters, including `/`. `?` matches 1 character except `/`.
- A pattern with no `/` and no wildcard, such as `schema`, matches a folder or a file of that name at any depth.
- Semspec does not read into an excluded folder.
- `--exclude` has no effect when `--graph` is a file. Semspec prints 1 warning.
- Quote a pattern with `*` or `?`, so the shell does not expand it.

## The schemas of the kinds

`semspec schema --profile profile.json --out schemas` writes `schemas/<kind id>.schema.json` for each kind. Each file is a JSON Schema (draft 2020-12) that holds only what the profile knows: the id with the prefix of the kind, the kind, the title, statement and lifecycle fields, the parent and link fields, the refs, the parts, the checks and the status. The schema allows other fields. An editor can use the schemas to check the YAML files.

## The graph

The graph is an object with a list of nodes. See `schema/graph.schema.json`.

```json
{ "nodes": [ { "id": "epic-checkout", "kind": "epic", "products": ["prd-shop"] } ] }
```

- A node has an `id`, a `kind` and any other fields. The profile can rename the 3 keys in its `source` object.
- A field that the profile names as a parent field or a link field holds a list of node ids.
- A field that the profile names as a part field holds a list of parts. A part is an object. The explorer shows each part as a node of its own.
- A field that the profile names as the check field holds a list of checks. A check is an object. 2 checks with the same type and key share 1 node.
- A node with no `title` gets one from its id, in sentence case. The explorer takes the casing of each word from the texts of the graph, so an acronym that the texts write in capitals stays in capitals.
- `disclosure` and `problems` are optional. A producer can use them to report what it found.

## The profile

The profile is a JSON or YAML object. See `schema/profile.schema.json` and the 2 examples in `fixtures/`.

| Key | Meaning |
|---|---|
| `project` | The name of the project. The page shows it as secondary text. |
| `source` | The keys of the list of nodes, the id and the kind. |
| `fields` | The fields for the title, the statement, the level and the delivery state, and a pattern that cuts a prefix from an id. |
| `lifecycle` | The field of the state, a fallback, a fallback for each kind, and the states that show muted. |
| `kinds` | The node kinds: id, label, plural, role, colour for the light and the dark theme, parent field groups, a citation rule and the chips of a summary. |
| `edges` | A label pair for each edge name, and a `down` flag for an edge whose target is the more general node. |
| `links`, `refs`, `supersededBy` | Link fields that are not parent fields. |
| `linkedScopeEdges` | The edges that pull a linked node into the scope of a node. |
| `parts` | Which kinds own parts, in which field, and the fields of a part. |
| `checks` | The check field, the check kind, the check types and their identity. |
| `status` | A status field with 3 values, 1 for each tone: good, warn and bad. A node with no status of its own gets the roll-up of the nodes below it: all good is good, all bad is bad, and a mix is warn. A node with a muted lifecycle does not count. A toggle colours the canvas by status, and a filter selects the status values. |
| `fieldFilters` | Filters on a list field or a text field: the field, a label, labels for values, and a separator that groups the values in the picker. A node without the field takes the values of the nodes above or below it. The table has a column for each field. |
| `facets`, `entry`, `groups` | The group facet, the start page and the names of tree groups. |
| `details` | The sections of the details panel: properties, text sections, option lists, source lists, object lists and citations. |

A kind has 1 of 4 roles.

- `hierarchy`: the node sits in the tree. `parents` lists groups of parent fields. The first group that names a node places the node in the tree. Every group counts for the scope.
- `part`: the node comes from a part field of its owner.
- `linked`: the node links to the hierarchy and has its own tree group. A scope pulls it in when a node of the scope links to it.
- `check`: the node comes from a check field.

A kind can set `placedUnder`. A node of that kind that reaches no node of the named kind goes to a warning group in the tree.

## Develop

```
npm install
npm test          # unit tests, build tests and CLI tests
npm run typecheck
npm run build     # the app in dist/app and the command line tool in dist/cli
```

The pure logic is in `src/core`. It has no framework dependency. The app is in `src/app`. It uses React, shadcn/ui on Base UI, Tailwind CSS, React Flow with dagre, and TanStack Table. The command line tool is in `src/cli`. The fixtures in `fixtures/` use 2 profiles with different kinds.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
