# Requirement Explorer

Requirement Explorer shows a requirement graph in a browser. It has a hierarchy tree, a scope by any node, a walk of the graph by expansion, Graph, Cards and Table views, and a details panel.

The tool reads 2 JSON files. The graph holds the nodes. The profile says what the fields of the nodes mean. The same tool shows any graph that a profile describes.

## Use

```
requirement-explorer serve --graph graph.json --profile profile.json [--port 4173] [--host 127.0.0.1]
requirement-explorer build --graph graph.json --profile profile.json --out explorer.html
```

- `serve` starts a server on localhost. It reads both files again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.

Both commands check the 2 files first and stop with a message when a file is not valid.

## The graph

The graph is a JSON object with a list of nodes. See `schema/graph.schema.json`.

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

The profile is a JSON object. See `schema/profile.schema.json` and the 2 examples in `fixtures/`.

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
