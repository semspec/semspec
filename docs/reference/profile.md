---
id: profile
kind: reference
title: The profile
description: The keys of a profile.
order: 2
related: [markdown-folder, kinds-and-roles, edges, vocabularies, provenance, export, layouts, cross-links]
documents: [feat-profile, req-profile-only, req-validate-profile]
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
| `status` | A status field with 3 values, 1 for each tone: good, warn and bad. A node with no status of its own gets the roll-up of the nodes below it: all good is good, all bad is bad, and a mix is warn. A node with a muted lifecycle does not count. A toggle colours the canvas by status, and a filter selects the status values. |
| `fieldFilters` | Filters on a list field or a text field: the field, a label, labels for values, a separator that groups the values in the picker, and an optional `from`. A node without the field takes the values of the nodes above or below it. The table has a column for each field. |
| `vocabularies`, `fieldVocabularies` | The codes that a field can take, and what each code means. See [Vocabularies](vocabularies.md). |
| `search` | The words that the search reads. `synonymFields` names node fields with words that mean the same as the title, for example a list of words to avoid. `fields` names more node fields to index. `boost` maps a field name to a weight. The built-in names are `id`, `title`, `sub`, `statement` and `parts`, with the weights 2, 3, 1, 1 and 1. A coded field is indexed under its own name with the weight 1. See [MCP server](mcp.md). |
| `provenance` | Where a fact comes from: the fields of the marker, the source, the date, the agent and the note, and the markers that need a source. See [Provenance](provenance.md). |
| `iri`, `fieldIris` | The IRIs of the export: a base, prefixes, the field that holds a node IRI, and the property of a field. A kind, an edge, an edge property, a vocabulary and a concept can name an `iri` too. See [Export](export.md). |
| `layout` | The layout of the Graph and Cards views. The optional `default` is `layered`, `grouped` or `force`. The optional `groupEdge` names the edge whose target is the container of its source. The value `grouped` needs `groupEdge`. See [Layouts](../guide/layouts.md). |
| `facets`, `entry`, `groups` | The group facet, the start page and the names of tree groups. |
| `details` | The sections of the details panel: properties, text sections, option lists, source lists, object lists, tagged lists and citations. |

A profile can also read a node from a Markdown page. See [Markdown pages as nodes](../guide/markdown-folder.md).
