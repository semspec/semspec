---
id: workspace
kind: guide
title: Workspaces
description: Keep several graphs about 1 system on 1 page.
order: 4
related: [cross-links, profile, yaml-folder]
documents: [feat-connect, cap-workspace, req-workspace-file, req-workspace-page, req-embed-provider]
---
A user can keep several graphs about 1 system, for example a requirements graph and a domain model. A workspace file lists them. The page holds all graphs, with a switch between them.

```json
{
  "title": "Shop workspace",
  "graphs": [
    { "id": "req", "label": "Requirements", "graph": "product/graph.json", "profile": "product/profile.json" },
    { "id": "domain", "label": "Domain model", "graph": "domain/graph.json", "profile": "domain/profile.json", "exclude": ["schema"] }
  ]
}
```

- The workspace file is JSON or YAML. See [`schema/workspace.schema.json`](../../schema/workspace.schema.json) and [`fixtures/workspace/`](../../fixtures/workspace/).
- A path is relative to the workspace file. `graph` and `profile` take the same files as `--graph` and `--profile`.
- `id` is unique. A cross link names it. `label` is the name in the switch. `exclude` is optional and works like `--exclude`.
- `search` is optional. Its key `embeddings` names the model for meaning search of all graphs, for example `"search": { "embeddings": { "provider": "ollama", "model": "<model>" } }`. It wins over the same key in a profile. The settings are in [Meaning search](meaning-search.md).
- Each graph and each profile is checked as in the single-graph form. A message names the graph id.
- `serve` reads all inputs again on each page load.
- The page title is the workspace title. The header shows the label of the active graph and a switch when the workspace has more than 1 graph.
- Each graph keeps its state. A return to the graph restores it. See [What the page remembers](state.md).
