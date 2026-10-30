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

## Install

Semspec is not on npm yet. Install it from GitHub:

```
npm install github:radoystoyanov/semspec#<commit or tag>
```

The install builds the tool. It needs Node 20 or later.

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
- A node with no value in the kind key gets `source.defaultKind`, when the profile sets it.
- A field that the profile names as an embedded field holds an object, a string or a number. The explorer makes 1 node for each distinct id, and the owners link to it. A string or a number is the id, and the new node has no other field. An object holds its id in the key that `id` names. A node of the graph with the same id wins.
- A field that the profile names as a part field holds a list of parts. A part is an object. The explorer shows each part as a node of its own.
- A field that the profile names as the check field holds a list of checks. A check is an object. 2 checks with the same type and key share 1 node.
- A node with no `title` gets one from its id, in sentence case. The explorer takes the casing of each word from the texts of the graph, so an acronym that the texts write in capitals stays in capitals.
- `disclosure` and `problems` are optional. A producer can use them to report what it found.

## The profile

The profile is a JSON or YAML object. See `schema/profile.schema.json` and the 2 examples in `fixtures/`.

| Key | Meaning |
|---|---|
| `project` | The name of the project. The page shows it as secondary text. |
| `source` | The keys of the list of nodes, the id and the kind. The optional `defaultKind` is the kind of a node with no value in the kind key. |
| `fields` | The fields for the title, the statement, the level and the delivery state, and a pattern that cuts a prefix from an id. |
| `lifecycle` | The field of the state, a fallback, a fallback for each kind, and the states that show muted. |
| `kinds` | The node kinds: id, label, plural, role, colour for the light and the dark theme, parent field groups, a citation rule (with an optional `name` path for the display name of the source) and the chips of a summary. |
| `edges` | A label pair for each edge name, and a `down` flag for an edge whose target is the more general node. |
| `links`, `refs`, `supersededBy` | Link fields that are not parent fields. |
| `linkedScopeEdges` | The edges that pull a linked node into the scope of a node. |
| `parts` | Which kinds own parts, in which field, and the fields of a part. |
| `embedded` | Objects in a node that are nodes of their own: the owner kind, the dotted path of the object, the new kind, the key of the id in the object (needed only for an object) and the edge. The edge is a parent field of the owner. It differs from the field. |
| `checks` | The check field, the check kind, the check types and their identity. |
| `status` | A status field with 3 values, 1 for each tone: good, warn and bad. A node with no status of its own gets the roll-up of the nodes below it: all good is good, all bad is bad, and a mix is warn. A node with a muted lifecycle does not count. A toggle colours the canvas by status, and a filter selects the status values. |
| `fieldFilters` | Filters on a list field or a text field: the field, a label, labels for values, a separator that groups the values in the picker, and an optional `from`. A node without the field takes the values of the nodes above or below it. The table has a column for each field. |
| `facets`, `entry`, `groups` | The group facet, the start page and the names of tree groups. |
| `details` | The sections of the details panel: properties, text sections, option lists, source lists, object lists, tagged lists and citations. |

## Tagged lists and the filter by tag

A tagged list is a list of objects. Each object has exactly 1 key, the tag. The value of the tag is an object of inner keys, or an empty object:

```json
{ "id": "n1", "origin": [ { "a": { "area": "X" } }, { "b": { "type": "Y", "property": "Z" } }, { "c": {} } ] }
```

`details.taggedLists` shows the list in the details panel:

```json
{ "title": "Origin", "field": "origin", "labels": { "a.area": "Area of A", "b.type": "Type of B", "b.property": "Property of B", "c": "Note" } }
```

- Each inner key and value of a tag gives the line `<label>: <value>`. The label is `labels["<tag>.<key>"]`.
- A tag with no inner key gives the line `labels["<tag>"]`.
- A missing label falls back to `<tag> <key>` as written, or to the tag.
- An entry that is not an object with exactly 1 key shows as compact JSON.

A `fieldFilters` entry with `"from": "keys"` takes its values from the keys of the objects in the list. The values above are `a`, `b` and `c`. The `values` labels apply to them, in the picker and in the table column. Without `from`, the values are the items of the field. A node with an empty list or no field has the value `""`, shown as None.

A kind has 1 of 4 roles.

- `hierarchy`: the node sits in the tree. `parents` lists groups of parent fields. The first group that names a node places the node in the tree. Every group counts for the scope.
- `part`: the node comes from a part field of its owner.
- `linked`: the node links to the hierarchy and has its own tree group. A scope pulls it in when a node of the scope links to it.
- `check`: the node comes from a check field.

A kind can set `placedUnder`. A node of that kind that reaches no node of the named kind goes to a warning group in the tree.

## The requirements of Semspec

The repository keeps its own requirements as a Semspec graph in `requirements/`. `requirements/profile.yaml` is the profile. `requirements/graph/` holds 1 YAML file for each node, in a folder for each kind. Each acceptance condition names the tests in `test/` that prove it. A test in `test/build.test.ts` fails when a named test does not exist.

```
npm run build                 # once, to build the command line tool
npm run requirements          # serves the graph on http://127.0.0.1:4173
npm run requirements:build    # writes dist/requirements.html
```

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
