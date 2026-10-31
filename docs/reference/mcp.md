---
id: mcp
kind: reference
title: MCP server
description: The command semspec mcp, its tools and its resources.
order: 9
related: [cli, workspace, provenance, vocabularies]
documents: [req-mcp-serve, req-mcp-read-tools, req-mcp-check-tools, req-mcp-resources, req-navigate-search, req-search-keyword, req-search-synonyms, req-search-context]
---
## Command

```
semspec mcp --graph <graph> --profile <profile> [--exclude <pattern>]...
semspec mcp --workspace <file>
```

The command serves a graph or a workspace to an AI agent over the Model Context Protocol. The transport is stdio.

- The command checks the inputs like `serve`. When an input is not valid, it writes the message to stderr and exits with code 1.
- Stdout carries only protocol messages. The server writes warnings and logs to stderr.
- The server reads all inputs again on each tool call and on each resource read. An edit of a file shows in the next answer. If a file is not valid at that time, the call returns an error with the message.
- A single graph has the id `graph`. A workspace uses the ids of its workspace file.
- Every tool takes an optional `graph`. The default is the first graph. The tool `search` is the exception: its default is all graphs.

## Client configuration

An agent starts the server as a child process. This block works in the settings of most MCP clients:

```json
{
  "mcpServers": {
    "semspec": {
      "command": "npx",
      "args": ["semspec", "mcp", "--workspace", "/path/to/workspace.json"]
    }
  }
}
```

For one graph, use `"args": ["semspec", "mcp", "--graph", "/path/to/graph", "--profile", "/path/to/profile.yaml"]`.

## Answers

Each answer is one line of compact JSON in a text block. A node appears as its `id`, `kind` and `title`, with only the fields that the tool needs.

`limit` caps each list. The default is 50 and the largest value is 500. When a tool cuts a list, the answer has a `truncated` object. Its keys name the lists, and its values are the numbers of omitted items.

A failed call returns `isError: true` and a text that says why. An unknown id gives `Unknown node id "<id>" in the graph "<graph>".`

## Tools

### schema

Describes the profile.

| Input | Meaning |
| --- | --- |
| `graph` | The graph id. |
| `kind` | Optional. A kind id. The answer is then the JSON Schema of that kind. |

The answer has `kinds` (id, label, role, parent fields), `edges` (name, labels, `from`, `to`, property types), `vocabularies` (codes, labels, definitions), `provenance`, `crossLinks`, `lifecycle` and `status`.

```json
{"graph":"domain","kinds":[{"id":"shop","label":"Shop","role":"hierarchy","prefix":"shop-","parentFields":["ownedBy"]}],"edges":[{"name":"ownedBy","labels":["Owned by","Owns"],"down":true,"from":["shop"],"to":["group"],"properties":{"share":{"type":"number","required":true}}}],"vocabularies":[{"id":"how","label":"How known","concepts":[{"code":"verified","label":"Verified"}]}],"provenance":{"marker":{"field":"how","vocabulary":"how"},"requireSource":["verified"]},"crossLinks":[{"field":"area","graph":"req","label":"Area in the requirements"}]}
```

### search

Finds nodes by words.

| Input | Meaning |
| --- | --- |
| `query` | Required. The words to find, as keywords or as a question. |
| `graph` | Optional. The id of 1 graph. The default is all graphs of the workspace. |
| `kinds` | Optional. A list of kind ids. A hit has one of these kinds. |
| `lifecycles` | Optional. A list of lifecycle states. |
| `statuses` | Optional. A list of status values. The value is the own status or the roll-up. |
| `scope` | Optional. A node id. A hit is the node, a node below it in the scope, or a linked node or check of those. |
| `limit` | As above. It caps the hits. |

The ranking is BM25 over the id, the title, the statement, the text of the parts, and the labels and definitions of the coded fields of each node. A word is lower case, and a plural ending is cut. A code such as `PSD2` stays whole. A query word with no match also matches the words that start with it. See [The profile](profile.md) for the keys `search.fields` and `search.boost`.

The query widens with synonyms. A synonym counts less than a word of the query. The synonyms are:

- The alt labels of a vocabulary concept. A query word that matches the label, the code or an alt label of a concept also searches the other words of the concept. See [Vocabularies](vocabularies.md).
- The fields that `search.synonymFields` names. A query word that matches the title of a node also searches the words of these fields of the node, and the other way round.

A node whose id equals the query, or a word of the query, comes first. A node whose title equals the query comes next. Nodes of the role check are not searched.

The answer has the `total` of matching nodes and the `hits`. A hit has `graph`, `id`, `kind`, `title`, `score`, `parent` (the first parent, or null), `status` (null when the profile has no status) and `snippet`. The snippet puts the matched words in `**`. Scores of different graphs are not on the same scale. The answer sorts by score all the same. A query with no match returns an empty list. When the limit cuts the hits, `truncated.hits` gives the omitted count.

The example uses `limit` 1.

```json
{"query":"prepaid code","total":7,"hits":[{"graph":"domain","id":"pay-voucher","kind":"method","title":"Voucher payment","score":9.51,"parent":null,"status":null,"snippet":"The buyer pays with a **prepaid** **code**."}],"truncated":{"hits":6}}
```

### get

Returns 1 node.

| Input | Meaning |
| --- | --- |
| `id` | Required. The node id. |
| `graph`, `limit` | As above. |

The answer has `kind`, `title`, `statement`, `lifecycle`, `status` (the own value or the roll-up of the nodes below), `fields`, `parents`, `childCount`, `edges` (`out` and `in`, grouped by edge name, each item with its `note` and `props`), `provenance`, `crossLinks` and `usedBy` (nodes of other graphs that link to this node).

```json
{"graph":"req","id":"story-pay-by-card","kind":"story","title":"Pay by card","lifecycle":"planned","status":{"value":"partial","label":"Partial","tone":"warn","own":false},"fields":{"priority":"high"},"parents":[{"id":"epic-checkout","kind":"epic","title":"Checkout"}],"edges":{"out":{"complies":[{"id":"std-card-data","kind":"standard","title":"Card Data Standard Clause 3(a)"}]},"in":{}},"crossLinks":[{"field":"concerns","label":"Concerns","graph":"domain","id":"pay-card","title":"Card payment"}],"usedBy":[]}
```

### trace

Follows the scope parents.

| Input | Meaning |
| --- | --- |
| `id` | Required. The node id. |
| `direction` | Required. `up` or `down`. |
| `depth` | For `down`. The number of levels. The default is 2. |
| `graph`, `limit` | As above. For `down`, `limit` caps the number of nodes. |

With `up`, the answer has `paths`. Each path is a list of ids from the node to a root. The map `nodes` gives the kind and the title of each id.

```json
{"graph":"req","direction":"up","node":{"id":"story-pay-by-card","kind":"story","title":"Pay by card"},"paths":[["story-pay-by-card","epic-checkout","prd-shop"]],"nodes":{"prd-shop":{"kind":"product","title":"Shop"}}}
```

With `down`, the answer has a nested `tree`. A node has `more` when its children are not all shown. A node under 2 parents has `seen: true` when it shows again. `below` is the number of all nodes below.

```json
{"graph":"req","direction":"down","depth":1,"tree":{"id":"epic-checkout","kind":"epic","title":"Checkout","children":[{"id":"story-pay-by-card","kind":"story","title":"Pay by card","more":4}]},"below":5}
```

### impact

Lists the nodes that depend on a node.

| Input | Meaning |
| --- | --- |
| `id` | Required. The node id. |
| `graph`, `limit` | As above. `limit` caps the items of each group. |

A node depends on it when it is below it in the scope, when it has an edge to it, or when it has a cross link to it from another graph. The answer groups the nodes by graph and kind. `via` says why: `below`, `edge:<name>` or `cross:<field>`.

```json
{"graph":"domain","node":{"id":"pay-card","kind":"method","title":"Card payment"},"total":14,"groups":[{"graph":"req","kind":"story","count":4,"items":[{"id":"story-pay-by-card","title":"Pay by card","via":"cross:concerns"}]}]}
```

### gaps

Lists what is missing in a scope.

| Input | Meaning |
| --- | --- |
| `scope` | Optional. A node id. The default is the whole graph. |
| `graph`, `limit` | As above. |

The answer has `counts` and these lists:

- `status`: nodes with a status of tone warn or bad.
- `uncheckedParts`: parts with no check, with their `owner`.
- `withoutSource`: nodes that need a source and have none (see [Provenance](provenance.md)).
- `unplaced`: nodes that the profile wants under a kind, and that are not.
- `unresolvedLinks`: links to a node that the graph lacks.
- `brokenCrossLinks`: cross links to a node that the other graph lacks.

With a `scope` and a profile with a status, the answer also has `rollup`.

```json
{"graph":"req","scope":null,"nodes":24,"counts":{"status":2,"uncheckedParts":1,"withoutSource":0,"unplaced":2,"unresolvedLinks":0,"brokenCrossLinks":0},"status":[{"id":"story-loose-child","kind":"story","title":"Loose child","status":"fail","tone":"bad"}],"uncheckedParts":[{"id":"story-pay-by-card#charged","kind":"scenario","title":"Charged","owner":"story-pay-by-card"}],"withoutSource":[],"unplaced":[{"id":"story-loose","kind":"story","title":"Loose"}],"unresolvedLinks":[],"brokenCrossLinks":[]}
```

### validate

Checks 1 new node as if it were added to the graph. The tool writes nothing.

| Input | Meaning |
| --- | --- |
| `node` | Required. The node as YAML or JSON text. |
| `graph` | As above. |

The tool checks the node against the JSON Schema of its kind. It also checks the graph rules: unknown kind, duplicate id, link fields, vocabulary codes, edge constraints, edge properties and provenance rules. It reports only what the new node adds. The edge and provenance rules apply once the structure of the node is right. An unknown link target and an unknown status value are warnings.

```json
{"graph":"req","valid":false,"errors":["The node/epics must be array"],"warnings":[]}
```

## Resources

| URI | Content |
| --- | --- |
| `semspec://<graph>/profile` | The profile as JSON, with the vocabulary files read. |
| `semspec://<graph>/vocabularies` | The vocabularies by id, each with its codes, labels and definitions, as JSON. |

The server lists 2 resources for each graph.
