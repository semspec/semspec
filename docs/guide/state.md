---
id: state
kind: guide
title: What the page remembers
description: Keep the state of each graph in memory, in the browser storage and in the link, and reset it.
order: 11
related: [workspace, layouts]
documents: [cap-view-state, req-state-memory, req-state-storage, req-state-link]
---
The browser app remembers what you did in each graph. A switch to another graph and back, a reload and a link all bring the view back.

## What it remembers

For each graph of the workspace, the page keeps:

- The scope and its depth, the walk and the history of the walk.
- The filters, the selected node or edge, and the view (Graph, Cards or Table).
- The layout that you picked, and the position and zoom of the canvas in each mode.
- The open groups of the tree, and the widths of the table columns.
- The table under the canvas, the side panel and the status colour.

For the workspace, the page keeps the active graph.

The page does not keep the positions that you gave to single nodes, the sort and the page of the table, or the text in the search box of the tree. The theme has its own setting.

## Where it keeps the state

- In memory: a switch to another graph and back restores the graph.
- In the browser storage: a reload restores all graphs. The page uses `localStorage` with the key `semspec:<workspace title>:<hash of the graph ids>`. Two workspaces never share a state.
- In the hash of the address: `#graph=<id>&scope=<id>&node=<id>`. A link with this hash opens the same graph, scope and node. The hash wins over the stored state for these 3 values. An unknown id is ignored. The page changes the hash without a new history entry. A page that opens from a file uses the same hash. The page ignores a hashchange event that its own write caused, so a late event never brings back an older selection.

The stored state has a version. A state of another version is ignored. A node, a filter value or a column that the graph no longer has is dropped when the page loads, and the rest of the state loads. When the browser blocks the storage, the page works and starts fresh.

## Reset the view

Open the menu in the header and pick Reset the view. The page clears the stored state of the workspace and starts fresh in each graph. The theme stays.
