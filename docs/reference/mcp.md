---
id: mcp
kind: reference
title: MCP server
description: The command semspec mcp, its tools and its resources.
order: 9
related: [cli, workspace, provenance, vocabularies]
documents: [req-mcp-serve, req-mcp-read-tools, req-mcp-check-tools, req-mcp-resources, req-navigate-walk, req-navigate-search, req-search-keyword, req-search-synonyms, req-search-context, req-context-slice, req-embed-hybrid, req-coverage-query]
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

The tool `slice` answers with Markdown text by default. It answers with one line of JSON when `format` is `json`.

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
| `mode` | Optional. `keyword`, `hybrid` or `vector`. The default is `hybrid` when the graph has an index of vectors, and `keyword` when it has none. |

The ranking is BM25 over the id, the title, the statement, the text of the parts, and the labels and definitions of the coded fields of each node. A word is lower case, and a plural ending is cut. A code such as `PSD2` stays whole. A query word with no match also matches the words that start with it. See [The profile](profile.md) for the keys `search.fields` and `search.boost`.

The query widens with synonyms. A synonym counts less than a word of the query. The synonyms are:

- The alt labels of a vocabulary concept. A query word that matches the label, the code or an alt label of a concept also searches the other words of the concept. See [Vocabularies](vocabularies.md).
- The fields that `search.synonymFields` names. A query word that matches the title of a node also searches the words of these fields of the node, and the other way round.

With a configured embedding model and an index, `hybrid` also ranks the nodes by cosine to the query vector and merges both rankings with reciprocal rank fusion (k = 60). `vector` returns the ranking by cosine only, at most 50 nodes. See [Meaning search](../guide/meaning-search.md). A `command` provider and a remote endpoint run only with the opt-in `--allow-command` or `--allow-remote` on `semspec mcp`, or with the variables `SEMSPEC_ALLOW_COMMAND=1` and `SEMSPEC_ALLOW_REMOTE=1`. Without it, the tool uses keywords only and says so in `notes`. When the model does not answer, or the index does not fit the setting, the tool uses keywords only and the answer has `notes`, a list of short reasons. The answer of a search with no setting has no `notes`.

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

The answer has `kind`, `title`, `statement`, `lifecycle`, `status` (the own value or the roll-up of the nodes below), `fields`, `parents`, `childCount`, `edges` (`out` and `in`, grouped by edge name, each item with its `note` and `props`), `provenance`, `links` (the links of the node to outside tools, as `{ label, url }`), `crossLinks` and `usedBy` (nodes of other graphs that link to this node). An item of the check edge in `edges.out` has `links` too.

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

### walk

Returns the neighbours of a node, grouped by edge. Use it to move through the graph step by step.

| Input | Meaning |
| --- | --- |
| `id` | Required. The start node. |
| `graph` | As above. |
| `edges` | Optional. Edge names and cross link fields to follow. The default is all. |
| `direction` | Optional. `out`, `in` or `both`. The default is `both`. |
| `kinds` | Optional. A list of kind ids. The walk shows and follows only nodes of these kinds. |
| `depth` | Optional. The number of steps, from 1 to 3. The default is 1. |
| `crossLinks` | Optional. When true, the walk also follows the cross links into other graphs of a workspace. The default is true. |
| `limit` | As above. It caps the nodes of the whole answer. |

The answer has `steps`. Step 1 holds the direct neighbours. Step 2 holds the neighbours of those, and so on. A step has `groups`. A group has the edge name `edge`, the `direction` (`out` or `in`), the `label` and the `nodes`. The label is the edge label for that direction, for example "Owned by" for `out` and "Owns" for `in`. A group of a cross link has `cross: true` and the label of the cross link. A node has `graph`, `id`, `kind`, `title` and `status` (null when the profile has no status). It also has `props` and `note` when the edge has them, and `from` (the id of the node of the previous step) from step 2 on.

A node shows once, in the step where the walk reaches it first. The walk does not return to the start node.

With `depth` above 1, the answer also has `paths`. It has 1 line for each node from step 2 on, and the line is the way from the start node. `-edge->` and `<-edge-` are edges, `=field=>` and `<=field=` are cross links, and a node of another graph reads `graph:id`. A flat list of lines is shorter than a tree and an agent can read it at once.

When the limit cuts the nodes, the walk stops at that step. The answer has `truncated.nodes` (the omitted count) and a `note`. An unknown edge or kind in `edges` or `kinds` is an error.

The example walks 2 steps with `edges` set to `concerns` and `offers`, `kinds` set to `method` and `shop`, and `limit` 3.

```json
{"graph":"req","node":{"id":"story-pay-by-card","kind":"story","title":"Pay by card"},"direction":"both","depth":2,"total":3,"steps":[{"step":1,"groups":[{"edge":"concerns","direction":"out","label":"Concerns","cross":true,"nodes":[{"graph":"domain","id":"pay-card","kind":"method","title":"Card payment","status":null}]}]},{"step":2,"groups":[{"edge":"offers","direction":"in","label":"Offered by","nodes":[{"graph":"domain","id":"shop-brightcart","kind":"shop","title":"Brightcart","status":null,"props":{"status":"active","how":"verified","source":"src-market-survey","retrieved":"2026-04-14","agent":"analyst-a"},"from":"pay-card"},{"graph":"domain","id":"shop-greenbasket","kind":"shop","title":"Greenbasket Foods","status":null,"props":{"status":"active","how":"verified","source":"src-market-survey","retrieved":"2026-04-14","agent":"analyst-a"},"from":"pay-card"}]}]}],"paths":["story-pay-by-card =concerns=> domain:pay-card <-offers- domain:shop-brightcart","story-pay-by-card =concerns=> domain:pay-card <-offers- domain:shop-greenbasket"],"truncated":{"nodes":3},"note":"The limit of 3 nodes cut 3 node(s). The walk stops at this step. Raise \"limit\" or narrow it with \"edges\" or \"kinds\"."}
```

### slice

Returns the brief for a task on 1 node. Call it at the start of a task. See [Agent context](../guide/agent-context.md).

| Input | Meaning |
| --- | --- |
| `id` | Required. The node id. |
| `graph` | As above. |
| `depth` | Optional. The levels of nodes below the node, from 1 to 5. The default is 1. |
| `budget` | Optional. The approximate size of the Markdown text in characters. The default is 6000. |
| `format` | Optional. `markdown` (the default) or `json`. |

The slice has these sections. A section with no content is left out, except Gaps.

- The node: kind, graph, lifecycle, status, statement, fields and provenance.
- The path to the root: ids and titles, root first.
- The parts, each with its status, its checks, or the line `No check.`
- The links of the node to outside tools, as Markdown links. In the JSON, `links` holds `{ label, url }`. Each check in the JSON can have `links` too.
- The checks of the node itself.
- The linked nodes: the nodes of a linked kind that the node links to or that link to it, and the nodes of a refs field. Each has its edge label, its note, its edge properties and its statement. The source, date, agent and note of an edge are provenance and are not shown.
- The cross links into other graphs, each with the title and the statement of the target.
- The coded values: the label and the definition of each code that the node uses in a field, in the marker of its provenance or in an edge property.
- The gaps of the node and its parts: status of tone warn or bad, parts with no check, nodes with no source, links to missing nodes.
- The deliverables: what the profile key `deliverables` says a node of this kind, or one of its parts, must deliver, and what is missing. The section says `All delivered.` when nothing is missing. The slice has no section when the profile states no deliverable for these kinds. In the JSON, `deliverables` has `defined` and `missing`.
- The nodes below the node to `depth`, with title and status. A part is not listed here. `(+n)` marks children that are not listed.

The `budget` counts the characters of the Markdown text. When the text is longer, the slice drops parts in this order: the levels of nodes below the node, from the deepest, then the statements of linked nodes and cross links (first to 160 characters, then fully), then all nodes below the node, then the definitions of the coded values. The node, the path, the parts, the gaps and the deliverables stay. The slice names each cut in the section Cut to fit the budget, and in `cut` in the JSON.

The example is `slice` on `story-pay-by-card` of the workspace fixture, with `graph` set to `req`.

```markdown
# `story-pay-by-card` Pay by card

Kind: Story | Graph: `req` | Lifecycle: planned | Status: Partial (rolled up from the nodes below)

The buyer pays by card. A card with 3DS asks for a second step. The PSP charges the card.

## Fields

- priority: high
- release: r1
- teams: payments, web

## Path to the root

`prd-shop` Shop > `epic-checkout` Checkout

## Parts

- `story-pay-by-card#declined` [Pass] A declined card shows a message.
  - Checks: Shows decline message (unit)
- `story-pay-by-card#charged` [Fail] A valid card is charged once.
  - No check.

## Linked nodes

- Complies with: `std-card-data` standard, Card Data Standard Clause 3(a)
  - A merchant shall not store card data.
- Noted by: `dec-use-two-psp` decision, Use two PSP [planned]
  - Two PSPs share the load.

## Cross links

- Concerns: `domain:pay-card` Card payment [method]
  - The buyer pays with a card at once.
- Concerns: `domain:prov-payvale` Payvale [provider]
  - Card and wallet payment provider.
- Concerns: `domain:prov-tillpay` Tillpay [provider]
  - Card provider for the central markets.
- Concerns: `domain:prov-quillpay` Quillpay [provider]
  - Wallet provider with a low fee.

## Gaps

- Status Fail: `story-pay-by-card#charged` Charged
- No check: `story-pay-by-card#charged` Charged

## Below the node (2, to depth 1)

- `story-pay-by-card-3ds` Pay by card 3DS
- `story-save-card` Save card [Pass]
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
- `missingDeliverables`: what a node misses of the deliverables that the profile states for its kind. Each item has `node`, `kind`, `title`, `deliverable`, `item` and `message`. See [The profile](profile.md#deliverables).

With a `scope` and a profile with a status, the answer also has `rollup`.

```json
{"graph":"req","scope":null,"nodes":24,"counts":{"status":2,"uncheckedParts":1,"withoutSource":0,"unplaced":2,"unresolvedLinks":0,"brokenCrossLinks":0,"missingDeliverables":0},"status":[{"id":"story-loose-child","kind":"story","title":"Loose child","status":"fail","tone":"bad"}],"uncheckedParts":[{"id":"story-pay-by-card#charged","kind":"scenario","title":"Charged","owner":"story-pay-by-card"}],"withoutSource":[],"unplaced":[{"id":"story-loose","kind":"story","title":"Loose"}],"unresolvedLinks":[],"brokenCrossLinks":[],"missingDeliverables":[]}
```

### coverage

Reports the status of the conditions in a selection of nodes. A condition is a node of a kind in the `parts` of the profile. The command `semspec coverage` takes the same inputs and gives the same answer. See [Command line](cli.md#coverage).

| Input | Meaning |
| --- | --- |
| `graph` | Optional. The id of 1 graph. The default is all graphs, unlike the other tools. |
| `scope` | Optional. A node id. The selection covers this node and its scope. With several graphs, it needs `graph`. |
| `kinds` | Optional. Keep the conditions that have one of these kinds, or that are below a node of one of these kinds. |
| `lifecycles` | Optional. Keep the conditions whose owner has one of these lifecycle states. |
| `deliveries` | Optional. Keep the conditions that have one of these deliveries, or that are below a node with one of them. |
| `statuses` | Optional. Keep the conditions with one of these status values. The empty text selects the conditions with no status. |
| `markers` | Optional. Keep the conditions that have one of these provenance markers, or that are below a node with one of them. |
| `fields` | Optional. An object with the values of each field filter of the profile, for example `{"area": ["core", "cli"]}`. |
| `group` | Optional. A hierarchy kind id or a field. The counts get 1 row for each node of the kind or each value of the field. |
| `list` | Optional. Status values, `no-status` or `no-check`. The answer lists the conditions that match one of them. |
| `limit` | Optional. The most conditions in the list. The default is 50. |
| `gate` | Optional. A list of tones: `good`, `warn` or `bad`. |
| `format` | `markdown` (the default) or `json`. |

The values of 1 filter are OR. The filters are AND. A filter works as in the explorer, with one difference: a condition has no kind, delivery or marker of its own, so it takes them from the nodes above it.

The answer has these parts:

- `total`: the counts of the selection. `conditions` is the number of conditions. `statuses` has 1 entry for each status value of the profile, with `count` and `percent`. `noStatus` and `noCheck` have `count` and `percent`. The percent is the share of the conditions in the selection.
- `graphs`: the same counts for each graph. With `group`, each graph has `groups`, a row for each group with the same counts. The percent in a group row is the share of the conditions in that group.
- `list`: with `list`. It has `statuses`, `limit`, `total` and `items`. An item has `graph`, `id`, `owner`, `status`, `tone`, `text` and `checks`. When the list is longer than `limit`, `truncated.list` says how many items the answer cuts.
- `gate`: with `gate`. It has `tones`, `pass` and `failing`. `failing` has an item for each condition whose status has one of the tones. It is never cut.

A group by a hierarchy kind has a row for each node of the kind that has a condition in the selection. A condition counts in each group of its owner, and a node counts the conditions of all nodes below it. A condition counts once in the total. With several graphs, the total adds the counts of a status value that the profiles share. A graph with no such group kind or field has no group rows.

```json
{"scope":null,"filters":{},"total":{"conditions":2,"statuses":[{"value":"pass","label":"Pass","tone":"good","count":1,"percent":50},{"value":"partial","label":"Partial","tone":"warn","count":0,"percent":0},{"value":"fail","label":"Fail","tone":"bad","count":1,"percent":50}],"noStatus":{"count":0,"percent":0},"noCheck":{"count":1,"percent":50}},"graphs":[{"graph":"req","label":"Requirements","conditions":2,"statuses":[{"value":"pass","label":"Pass","tone":"good","count":1,"percent":50},{"value":"partial","label":"Partial","tone":"warn","count":0,"percent":0},{"value":"fail","label":"Fail","tone":"bad","count":1,"percent":50}],"noStatus":{"count":0,"percent":0},"noCheck":{"count":1,"percent":50}}]}
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
