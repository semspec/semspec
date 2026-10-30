---
id: cli
kind: reference
title: Command line
description: The commands and options of the semspec command.
order: 1
related: [getting-started, yaml-folder, workspace, export, schemas]
documents: [req-build-info, req-serve, req-build-html, cap-validate, req-validate-graph, req-validate-profile]
---
## Commands

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
semspec build --workspace <file> --out workspace.html
semspec schema --profile <profile> --out <dir>
semspec export --graph <graph> --profile <profile> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec export --workspace <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec --version
semspec version --json
```

- `serve` starts a server on localhost. It reads both inputs again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.
- The page has a Light, Dark and System switch in the header. It keeps the choice in the browser storage of the viewer.
- `schema` writes 1 JSON Schema for each kind of the profile. See [The schemas of the kinds](schemas.md).
- `export` writes the graph for other tools. See [Export](export.md).
- `semspec --version` (or `-v`) prints `semspec <version> (<commit>)`, with ` dirty` after the commit when the tree was dirty at build time. `semspec version --json` prints `{ "name", "version", "commit", "dirty" }`. The page has the same text in `<meta name="generator">`.

`<graph>` is a JSON file, a YAML file or a folder of YAML files. `<profile>` is a JSON file or a YAML file (`.yaml` or `.yml`).

`--exclude` skips paths of a graph folder. It can repeat. See [The YAML folder](../guide/yaml-folder.md).

`--workspace` reads a workspace file instead of `--graph` and `--profile`. See [Workspace](../guide/workspace.md). It cannot combine with `--graph`, `--profile` or `--exclude`.

`serve` and `build` check the 2 inputs first and stop with a message when an input is not valid. A message about a YAML node names its file.
