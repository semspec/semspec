---
id: cross-links
kind: concept
title: Cross links
description: A node of 1 graph can point to a node of another graph in a workspace.
order: 4
related: [workspace, profile]
documents: [req-cross-links]
---
A profile declares the fields that point into another graph:

```json
"crossLinks": [ { "field": "terms", "graph": "domain", "label": "Uses term" } ]
```

- `field` is a field of a node. It holds 1 node id or a list of node ids of the target graph, for example `"terms": ["basket", "card"]` or `"term": "basket"`. An object with an `id` is not accepted.
- `graph` is the `id` of the target graph in the workspace file.
- `label` is the title of the section in the details panel.
- A cross link is not an edge of the graph. It does not change the tree, the scope, the walk or the canvas.
- A cross link to a graph that the workspace does not have is an error. An id that the target graph does not have is a warning, and the link is skipped.
- `field` must not be a parent field or a link field of the profile.
- `field` can be an `embedded` field of the profile with a plain id. Then each node that holds the id has the cross link, and the group node that the embedded field makes has it too. The group node has the same id as the value, so it points at the node with that id in the target graph. The details panel of the group node shows the link.
- The details panel shows a section with the label of each entry, and a section "Used by" with the label of the source graph for a node that other graphs point at. A click on an entry shows the node in its graph, selected and revealed in the tree. The Back button in the header returns to the previous graph and node.
