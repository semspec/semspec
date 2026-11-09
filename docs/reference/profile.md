---
id: profile
kind: reference
title: The profile
description: The keys of a profile.
order: 2
related: [external-links, markdown-folder, kinds-and-roles, edges, vocabularies, provenance, export, layouts, cross-links, specs]
documents: [feat-author, req-profile-only, req-validate-profile, req-deliverables, req-embed-provider, req-spec-presets, req-external-links]
---
The profile is a JSON or YAML object. See [`schema/profile.schema.json`](../../schema/profile.schema.json) and the 2 examples in [`fixtures/`](../../fixtures/).

| Key | Meaning |
|---|---|
| `project` | The name of the project. The page shows it as secondary text. |
| `source` | The keys of the list of nodes, the id and the kind. The optional `defaultKind` is the kind of a node with no value in the kind key. The optional `markdown.body` names the field that gets the text of a Markdown page. A graph folder reads `*.md` files only when `markdown` is set. See [Markdown pages as nodes](../guide/markdown-folder.md). |
| `fields` | The fields for the title, the statement, the level and the delivery state, and a pattern that cuts a prefix from an id. |
| `lifecycle` | The field of the state, a fallback, a fallback for each kind, and the states that show muted. |
| `kinds` | The node kinds: id, label, plural, role, colour for the light and the dark theme, parent field groups, a citation rule (with an optional `name` path for the display name of the source) and the chips of a summary. |
| `edges` | A label pair for each edge name, and a `down` flag for an edge whose target is the more general node. An entry can also have `target` (the key of the node id in an object of a link field, default `id`), `from` and `to` (the kinds of the 2 nodes of an edge) and `properties` (the declared properties of an edge). See [Edges](../concept/edges.md). |
| `links`, `supersededBy` | Link fields that are not parent fields. |
| `refs` | A field that holds a list of objects: `field`, `target` (the key of the node id in an object) and `note` (the key of the edge note). Give 1 entry or a list of entries. Each `field` needs an entry in `edges`, which gives the labels of its edge. An entry can have `many`, the key of a boolean in an object. When the boolean is true, the edge note gets the suffix `[]`, so a note `lines` reads `lines[]`. Every other key of an object is a property of the edge. |
| `crossLinks` | Fields that hold node ids of another graph of a workspace: the field, the id of the target graph and a label. See [Cross links](../concept/cross-links.md). |
| `linkedScopeEdges` | The edges that pull a linked node into the scope of a node. |
| `parts` | Which kinds own parts, in which field, and the fields of a part. |
| `embedded` | Objects in a node that are nodes of their own: the owner kind, the dotted path of the object, the new kind, the key of the id in the object (needed only for an object) and the edge. The edge is a parent field of the owner. It differs from the field. |
| `checks` | The check field, the check kind, the check types and their identity. |
| `evidence` | Derives the status of the conditions from test reports. The shared settings are `record`, `root`, `inputs`, `exclude` and `fallback`. `adapters` lists the report formats: each entry has `adapter` (`junit` or `vitest-json`), `reports` (paths relative to `root`), `checkTypes` (the check types it answers) and `key` (the key rule). The key rule is `class-method`, `file-name` or `file-titlepath`. It can name the check field of each part (`class`, `method`, `file`, `name`) and a `separator` for a title path. The key `verification` (with `classField` and `methodField`) is the alias for 1 JUnit adapter with the key rule `class-method`. A profile has `evidence` or `verification`, not both. See [Test evidence](../guide/test-records.md). |
| `externalLinks` | Links from a node or a check to an outside tool. Each entry has `label`, `template` and the optional `kinds`, `checkTypes` and `field`. See [External links](#external-links). |
| `status` | A status field with 3 values, 1 for each tone: good, warn and bad. A node with no status of its own gets the roll-up of the nodes below it: all good is good, all bad is bad, and a mix is warn. A node with a muted lifecycle does not count. A toggle colours the canvas by status, and a filter selects the status values. |
| `fieldFilters` | Filters on a list field or a text field: the field, a label, labels for values, a separator that groups the values in the picker, and an optional `from`. A node without the field takes the values of the nodes above or below it. The table has a column for each field. |
| `vocabularies`, `fieldVocabularies` | The codes that a field can take, and what each code means. See [Vocabularies](vocabularies.md). |
| `search` | The words that the search reads. `synonymFields` names node fields with words that mean the same as the title, for example a list of words to avoid. `fields` names more node fields to index. `boost` maps a field name to a weight. The built-in names are `id`, `title`, `sub`, `statement` and `parts`, with the weights 2, 3, 1, 1 and 1. A coded field is indexed under its own name with the weight 1. `embeddings` names the optional model for meaning search: `provider` (`ollama`, `openai-compatible` or `command`), `model`, and the optional `endpoint`, `dimensions`, `batch`, `apiKeyEnv`, `command`, `documentPrefix`, `queryPrefix` and `index`. The workspace file can hold the same key, and then it wins. Semspec ships no model and has no default model. See [Meaning search](../guide/meaning-search.md) and [MCP server](mcp.md). |
| `gates` | The gap kinds that fail `semspec check`: `gates.fail` lists any of `bad-status`, `no-check`, `no-source`, `unplaced`, `unresolved-link`, `broken-cross-link` and `missing-deliverable`. The default is none. See [Gates](../guide/gates.md). |
| `deliverables` | What a task on a node of a kind must deliver, by kind id. See [Deliverables](#deliverables). |
| `spec` | The settings of `semspec spec`. `roots` lists the kinds whose nodes get a default document. `presets` maps a name to the options of a section marker, for example `{ shape: table, status: [open] }`. A marker takes a set with `use=<name>`. An unknown option in a set is an error. See [Markdown specs](../guide/specs.md). |
| `provenance` | Where a fact comes from: the fields of the marker, the source, the date, the agent and the note, and the markers that need a source. See [Provenance](provenance.md). |
| `iri`, `fieldIris` | The IRIs of the export: a base, prefixes, the field that holds a node IRI, and the property of a field. A kind, an edge, an edge property, a vocabulary and a concept can name an `iri` too. See [Export](export.md). |
| `layout` | The layout of the Graph and Cards views. The optional `default` is `layered`, `grouped` or `force`. The optional `groupEdge` names the edge whose target is the container of its source. The value `grouped` needs `groupEdge`. See [Layouts](../guide/layouts.md). |
| `facets`, `entry`, `groups` | The group facet, the start page and the names of tree groups. |
| `details` | The sections of the details panel: properties, text sections, option lists, source lists, object lists, tagged lists and citations. |

A profile can also read a node from a Markdown page. See [Markdown pages as nodes](../guide/markdown-folder.md).

## External links

The key `externalLinks` lists link specs. A spec turns fields of a node or of a check into a link to an outside tool, for example a story in a story tool or a run in CI.

```yaml
externalLinks:
  - label: Story
    template: "https://stories.example.org/?path=/story/{story}"
    checkTypes: [story]
  - label: Tracker
    template: "https://tracker.example.org/items/{id}"
    kinds: [requirement]
```

| Key | Meaning |
|---|---|
| `label` | The text of the link. |
| `template` | An `http` or `https` URL with placeholders. `{story}` reads the field `story`. `{a.b}` reads a dotted path. |
| `kinds` | The node kinds that get the link. |
| `checkTypes` | The check types that get the link. A key of `checks.types`. |
| `field` | The link shows only when this field has a value. |

A spec with neither `kinds` nor `checkTypes` applies to every node and every check. The placeholder with the name of the key `source.id` reads the id of a node.

Semspec URL-encodes each value with `encodeURIComponent`, so `/` becomes `%2F`. The author of the template places each placeholder where an encoded value is valid. A link whose placeholder has no value does not show. After it fills the template, Semspec accepts only an `http` or `https` address.

`semspec check` reports a template with no placeholder and no fixed URL, a template that does not start with `http://` or `https://`, an unknown kind or check type, and a protocol other than `http` or `https`. See [Links to outside tools](../guide/external-links.md).

## Deliverables

The key `deliverables` states what a task on a node of each kind must deliver. An agent that reads the slice of a node knows when the task is done. The command `semspec deliverables`, the tool `gaps` and the gate `missing-deliverable` list what a node still misses.

```yaml
deliverables:
  requirement:
    parts: { min: 1 }
    checks: each-part
    status: [good]
    fields: [rationale]
    links: { governs: { min: 1, direction: in } }
  condition:
    checks: node
```

The key is a map from a kind id to an entry. Each part of an entry is optional. A node of a kind with no entry has no deliverable.

| Part | The node delivers |
|---|---|
| `parts` | At least `min` parts, as the profile key `parts` defines them. |
| `checks` | `each-part`: each part of the node has a check. `node`: the node has a check. Needs the profile key `checks`. |
| `status` | A status that is in the list. An item is a status value or a tone (`good`, `warn`, `bad`). The status of a node with parts or children rolls up from them. Needs the profile key `status`. |
| `fields` | A value in each listed node field. An empty text and an empty list have no value. |
| `links` | For each key, at least `min` links. A key is an edge or a cross link field. `direction` is `out` (the default) for the links of the node, or `in` for the links that name the node. `direction` has no effect on a cross link field. |
| `provenance` | `true`: the node has a value in the marker field and in the source field of the profile key `provenance`. |

Each missing item makes 1 finding with a short message, for example `The requirement "Pay" has the part "pay#declined" with no check.` Semspec rejects a profile that names an unknown kind, edge, cross link field or status. It also rejects a part that needs a profile key that the profile does not have.

