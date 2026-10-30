---
id: yaml-folder
kind: guide
title: The YAML folder
description: Keep a graph as a folder with 1 YAML file for each node.
order: 2
related: [markdown-folder, workspace, cli]
documents: [cap-read-folder, cap-exclude, req-read-folder, req-exclude-patterns, req-exclude-use]
---
A folder can hold the graph, with 1 file for each node. The folder can have sub-folders, for example 1 for each kind:

```
requirements/
  epic/epic-checkout.yaml
  story/story-pay-by-card.yaml
```

- Semspec reads every `*.yaml` and `*.yml` file below the folder, in sorted order of the path.
- A file that holds a mapping is 1 node. A file that holds a list of mappings is several nodes.
- The graph is `{ "<source.nodes>": [ ...the nodes... ] }`. The profile names the key in `source.nodes`.
- A single YAML file can also hold a whole graph, in the same shape as a JSON graph.
- `serve` reads the folder again on each page load, so an edit shows on reload.

A graph folder can sit next to folders that hold YAML but no nodes, for example `schema/` or `generated/`. Skip them with `--exclude`:

```
semspec build --graph requirements --profile profile.yaml --out explorer.html --exclude schema --exclude 'generated/**'
```

- A pattern matches a path relative to the graph folder, with `/` as separator.
- `*` matches any characters except `/`. `**` matches any characters, including `/`. `?` matches 1 character except `/`.
- A pattern with no `/` and no wildcard, such as `schema`, matches a folder or a file of that name at any depth.
- Semspec does not read into an excluded folder.
- `--exclude` has no effect when `--graph` is a file. Semspec prints 1 warning.
- Quote a pattern with `*` or `?`, so the shell does not expand it.

A folder of Markdown pages is also a graph. See [Markdown pages as nodes](markdown-folder.md).
