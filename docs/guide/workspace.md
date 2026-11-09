---
id: workspace
kind: guide
title: Workspaces
description: Keep several graphs about 1 system on 1 page.
order: 4
related: [cross-links, profile, yaml-folder]
documents: [feat-connect, cap-workspace, req-workspace-file, req-workspace-page, req-workspace-views, req-node-source, req-embed-provider]
---
A user can keep several graphs about 1 system, for example a requirements graph and a domain model. A workspace file lists them. The page holds all graphs, with a menu to switch between the views.

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
- `id` is unique. A cross link names it. `label` is the name of the graph. `exclude` is optional and works like `--exclude`.
- `search` is optional. Its key `embeddings` names the model for meaning search of all graphs, for example `"search": { "embeddings": { "provider": "ollama", "model": "<model>" } }`. It wins over the same key in a profile. The settings are in [Meaning search](meaning-search.md).
- Each graph and each profile is checked as in the single-graph form. A message names the graph id.
- `sourceRoot` is optional. It is the folder that holds the source files of the nodes, relative to the workspace file. `serve` shows the text of a source file in the Source section only when the file lies inside this folder. The default is the folder of the workspace file. See [The Source section](../reference/cli.md#the-source-section).
- `serve` reads all inputs again on each page load. It also watches the files and reloads the page when 1 of them changes. See [Live reload](../reference/cli.md#live-reload).
- The page title is the workspace title. The header shows the label of the active view. It shows a menu of the views when the workspace has more than 1 view.
- Each view keeps its state. A return to the view restores it. See [What the page remembers](state.md).

## Views

A view shows 1 graph in 1 way. The optional list `views` sets the views and their order in the menu. Without `views`, each graph is 1 view, in the order of the graphs, with the id and the label of the graph.

```yaml
title: Shop workspace
graphs:
  - { id: req, label: Requirements, graph: requirements, profile: requirements.profile.yaml }
  - { id: domain, label: Domain, graph: domain, profile: domain.profile.yaml }
views:
  - { id: req, label: Requirements, graph: req }
  - { id: domain, label: Domain model, graph: domain }
  - id: vocabulary
    label: Vocabulary
    graph: domain
    parents:
      term: [[inGroup], [inContext]]
      group: [[inContext]]
    layout: { default: grouped, groupBy: parents }
    filters: { kinds: [term, group] }
```

- `id` is unique among the views. `label` is the name in the menu. `graph` is the id of a graph of the workspace.
- `profile` is optional. It is the path of a profile file for the same graph data, relative to the workspace file. Without it, the view uses the profile of the graph.
- `parents` is optional. It maps a kind id to a parents rule. The rule replaces the rule of that kind for this view. Each other kind keeps its rule. The tree and the scope of the view follow the new rules.
- `layout` is optional. It has the same keys as `layout` in a profile. A key here replaces the same key of the profile. See [Layouts](layouts.md).
- `filters` is optional. It has the keys `kinds`, `lifecycles`, `deliveries`, `statuses`, `markers` and `fields` of the filters in the page. The page applies them when a person opens the view for the first time. A person can change them, and the page remembers the change.
- Two views of 1 graph show the same nodes with the same ids. Each view keeps its own state.
- A cross link names a graph. It opens in the first view of that graph.
- The link in the address holds the id of the view: `#graph=<view id>`. A view with the id of its graph keeps the link of that graph. A link that names a graph opens its first view.
- The check refuses a view id that appears twice, a view that names an unknown graph, a view profile that is not valid and a `parents` entry for an unknown kind. A message names the view id.
- Search, the MCP server, `check`, `export` and the coverage work on graphs. They ignore the views.
