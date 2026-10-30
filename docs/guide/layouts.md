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
- `grouped`: a node that is the target of the `groupEdge` edge from a node on the canvas is a container. Its members sit inside it. A container can sit inside a container. A member with 2 containers sits in the first one. The edges of the `groupEdge` name are hidden for the container of a member, because the nesting shows them. The switch is disabled when the profile has no `groupEdge`.
- `force`: `d3-force` places the nodes. The simulation runs a fixed number of ticks from start positions that follow the node order. The same input gives the same result. It suits a graph with no main direction.

A walk puts a new node next to its source in every layout.

```json
"layout": { "default": "grouped", "groupEdge": "epics" }
```
