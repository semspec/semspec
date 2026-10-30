---
id: edges
kind: concept
title: Edges
description: An edge has a kind, a note and properties. A profile can constrain them.
order: 3
related: [graph, profile, vocabularies]
documents: [req-edge-properties, req-edge-types, req-refs-list, req-embedded-edge-name]
---
The model is a labelled property graph, as in ISO GQL (ISO/IEC 39075) and PG-Schema. A node has a kind (its label) and fields (its properties). An edge has a kind, a note and properties.

An edge gets its properties from 2 places:

- A refs item: every key except the target key, the note key and the `many` key is a property. The item `{ "ref": "x", "text": "note", "since": "2024", "share": 0.4 }` gives an edge with the note `note` and the properties `since` and `share`.
- A link field: an item is a node id, or an object `{ "<target key>": "<id>", ...properties }`. The profile names the target key in `edges.<field>.target`. The default is `id`. An object without the target key is an error that names the node.

An embedded object, a part and a check make edges with no properties.

Parallel edges (the same source, target and kind) stay 2 edges when their properties differ, as GQL allows. The model keeps 1 edge when the properties are equal. The order of the keys does not matter.

A profile can declare constraints for an edge name:

```json
"edges": {
  "complies": {
    "labels": ["Complies with", "Complied with by"],
    "target": "std",
    "from": ["story"],
    "to": ["standard"],
    "properties": { "since": { "type": "date", "required": true }, "share": { "type": "number" } }
  }
}
```

- `from` and `to` list the kinds of the source node and of the target node. An edge with another kind is an error. A kind that the profile does not define is a profile error.
- `properties` declares the properties by name. The `type` is `string`, `number`, `boolean` or `date`. A property of the type `string` can have a `vocabulary`. See [Vocabularies](../reference/vocabularies.md). A `date` is an ISO date string: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Quote a year in YAML, so it stays a string.
- A property that `properties` does not declare is a warning. A missing required property and a value of the wrong type are errors. An edge name with no `properties` has no property check.
- `semspec schema` types a link field as a list of ids or objects, with the declared properties.

The details panel shows the properties after each edge, for example `since 2024 · share 0.4`. A click on an edge in the Graph view or the Cards view selects it. The panel then shows the kind, the source, the target, the note and the properties, with buttons to select the source or the target. The table has no column for edge properties.
