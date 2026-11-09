---
id: layouts
kind: guide
title: Layouts
description: Pick how the Graph view and the Cards view place the nodes.
order: 5
related: [profile, kinds-and-roles]
documents: [req-layouts]
---
The Graph view and the Cards view have 3 layouts. A profile picks the first one with `layout.default`. A switch in the toolbar of the canvas changes it.

- `layered`: dagre lays out the nodes from left to right. The general nodes are on the left. This is the default. It suits requirements.
- `grouped`: a node that is the target of the `groupEdge` edge from a node on the canvas is a container. Its members sit inside it. A container can sit inside a container. A member with 2 containers sits in the first one. The edges of the `groupEdge` name are hidden for the container of a member, because the nesting shows them. The switch is disabled when the profile has neither `groupEdge` nor `groupBy`.
- `force`: `d3-force` places the nodes. The simulation runs a fixed number of ticks from start positions that follow the node order. The same input gives the same result. It suits a graph with no main direction.

A walk puts a new node next to its source in every layout.

With `"groupBy": "parents"` the `grouped` layout nests each node in the container that the parents rule of its kind picks, as the tree does. The first group of the rule that names a node on the canvas picks the container. When no node of a group is on the canvas, the next group picks it. A line to a container that holds the node is hidden, because the nesting shows it. `groupBy` wins over `groupEdge`. `grouped` needs no `groupEdge` then. Without `groupBy`, the layout nests by `groupEdge` only.

```json
"layout": { "default": "grouped", "groupEdge": "epics" }
```

A profile that nests by the parents rule:

```json
"layout": { "default": "grouped", "groupBy": "parents" }
```
