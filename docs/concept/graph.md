---
id: graph
kind: concept
title: The graph
description: Read how a graph holds nodes, fields and the rules that make nodes.
order: 1
related: [kinds-and-roles, edges, profile]
documents: [feat-model, cap-nodes, req-titles, req-default-kind, req-embedded-nodes, req-embedded-plain-id, req-parts-checks]
---
The graph is an object with a list of nodes. See [`schema/graph.schema.json`](../../schema/graph.schema.json).

```json
{ "nodes": [ { "id": "epic-checkout", "kind": "epic", "products": ["prd-shop"] } ] }
```

- A node has an `id`, a `kind` and any other fields. The profile can rename the 3 keys in its `source` object.
- A field that the profile names as a parent field or a link field holds a list of node ids. An item can also be an object that holds the node id and the properties of the edge. See [Edges](edges.md).
- A node with no value in the kind key gets `source.defaultKind`, when the profile sets it.
- A field that the profile names as an embedded field holds an object, a string or a number. The explorer makes 1 node for each distinct id, and the owners link to it. A string or a number is the id, and the new node has no other field. An object holds its id in the key that `id` names. A node of the graph with the same id wins. The field can also be a `crossLinks` field. See [Cross links](cross-links.md).
- A field that the profile names as a part field holds a list of parts. A part is an object. The explorer shows each part as a node of its own.
- A field that the profile names as the check field holds a list of checks. A check is an object. 2 checks with the same type and key share 1 node.
- A check gets its title from the first title field of its type that has a value. A value with a space is a text. The title keeps the text and gives the first letter a capital. A value with no space is an identifier. The title is a sentence made from it.
- A node with no `title` gets one from its id, in sentence case. The explorer takes the casing of each word from the texts of the graph, so an acronym that the texts write in capitals stays in capitals.
- `disclosure` and `problems` are optional. A producer can use them to report what it found.
