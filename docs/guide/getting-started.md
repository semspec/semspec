---
id: getting-started
kind: guide
title: Getting started
description: Install Semspec and open a graph in the browser.
order: 1
related: [cli, yaml-folder]
documents: [cap-html, req-serve, req-build-html]
---
## Install

Semspec is not on npm yet. Install it from GitHub:

```
npm install --save-dev github:semspec/semspec
```

The install builds the tool. The lockfile keeps the commit. It needs Node 20 or later.

## First use

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
```

- `serve` starts a server on localhost. It reads both inputs again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.
