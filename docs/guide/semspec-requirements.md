---
id: semspec-requirements
kind: guide
title: The requirements of Semspec
description: See the requirements of Semspec as a Semspec graph.
order: 6
related: [develop, yaml-folder]
documents: [prd-semspec]
---
The repository keeps its own requirements as a Semspec graph in `requirements/`. `requirements/profile.yaml` is the profile. `requirements/graph/` holds 1 YAML file for each node, in a folder for each kind. Each acceptance condition names the tests in `test/` that prove it. A test in `test/build.test.ts` fails when a named test does not exist.

```
npm run build                 # once, to build the command line tool
npm run requirements          # serves the graph on http://127.0.0.1:4173
npm run requirements:build    # writes dist/requirements.html
```
