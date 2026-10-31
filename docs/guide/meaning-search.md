---
id: meaning-search
kind: guide
title: Meaning search
description: Add a search by meaning to the keyword search, with an embedding model that you choose and run.
order: 10
related: [cli, mcp, profile, workspace]
documents: [cap-embeddings, req-embed-provider, req-embed-index, req-embed-hybrid, req-embed-license]
---
The keyword search finds the words of the query. The search by meaning also finds a node that uses other words for the same idea. It needs an embedding model. An embedding model turns a text into a list of numbers, a vector. Texts with a similar meaning have similar vectors.

You choose the model and the program that runs it. You accept the licence of the model. Semspec ships no model, has no default model and has no model package in its dependencies. Without a setting, the search uses keywords only, and nothing fails.

## Set up

1. Run an embedding model with one of the 3 providers below.
2. Add `search.embeddings` to the workspace file or to the profile. The workspace file wins when both have it.
3. Run `semspec index`. It writes the index file.
4. Search as before. When an index exists and the model answers, `search` merges the keyword ranking and the ranking by meaning.

```yaml
search:
  embeddings:
    provider: ollama
    model: <the name of the model that you pulled>
```

In a workspace file, `search` is a key of the top level. In a profile, `embeddings` is a key of the existing `search` object.

| Setting | Meaning |
| --- | --- |
| `provider` | Required. `ollama`, `openai-compatible` or `command`. |
| `model` | Required. The name of the model. The provider passes it on. The index stores it. |
| `endpoint` | The base URL of the server. The default for `ollama` is `http://127.0.0.1:11434`. `openai-compatible` needs it. |
| `command` | The program and its arguments, as a list. Only for `command`. No shell reads it. |
| `apiKeyEnv` | The name of the environment variable that holds the API key. Only for `openai-compatible`. The key never sits in a file and Semspec never prints it. |
| `dimensions` | The size of the stored vectors. A longer vector is cut to this size and scaled to length 1. |
| `batch` | The most texts in 1 request. The default is 32. |
| `documentPrefix`, `queryPrefix` | A text that goes before each node text and before the query. Some models need it. See the table below. |
| `index` | The path of the index file, relative to the file that holds the setting. |

An endpoint on this machine (`127.0.0.1`, `::1` or `localhost`) needs no opt-in. An endpoint on another host receives the text of your nodes. Semspec sends it only with the option `--allow-remote` or `SEMSPEC_ALLOW_REMOTE=1`, for the same reason.

A relative path in the setting starts at the folder of the workspace file, or at the folder of the profile when the profile holds the setting.

## Providers

### Ollama

Install Ollama, pull an embedding model that you choose, and set the provider `ollama`. Semspec posts to `/api/embed`.

```yaml
search:
  embeddings: { provider: ollama, model: nomic-embed-text, documentPrefix: "search_document: ", queryPrefix: "search_query: " }
```

### OpenAI-compatible server

Use a local server that has `POST /v1/embeddings`, for example llama.cpp, LM Studio or vLLM. Semspec posts to `<endpoint>/v1/embeddings`.

```yaml
search:
  embeddings: { provider: openai-compatible, endpoint: "http://127.0.0.1:8080", model: my-model, apiKeyEnv: MY_EMBEDDING_KEY }
```

Set the key in the environment, never in the file: `export MY_EMBEDDING_KEY=...`. Leave `apiKeyEnv` out when the server needs no key.

### Command

Use a program of your own. This lets you run any runtime, for example transformers.js in your own script. Semspec starts the program with the folder of the setting as the working directory, writes this JSON to its stdin, and reads the vectors from its stdout.

```json
{ "model": "<the model setting>", "texts": ["first text", "second text"] }
```

The program writes a list of vectors, one for each text, as `[[0.1, 0.2], [0.3, 0.4]]` or as `{ "vectors": [[0.1, 0.2], [0.3, 0.4]] }`.

```yaml
search:
  embeddings: { provider: command, model: my-model, command: [node, embed.mjs] }
```

A command in a workspace file or a profile runs with your rights. A cloned repository could name any command. So Semspec runs a command only when you opt in outside the repository: use the option `--allow-command` on `semspec index`, `search`, `eval-search` or `mcp`, or set `SEMSPEC_ALLOW_COMMAND=1`. Without the opt-in, nothing runs. `search` uses keywords only and the result has a note that names the opt-in. `index` stops with an error.

## Build the index

```
semspec index --workspace workspace.yaml
semspec index --graph requirements/graph --profile requirements/profile.yaml
```

The command embeds the text of each node. It reads the same fields as the keyword index. It writes one index file for each graph, next to the graph: `<graph folder or file>.semspec-index.json`. Set `index` to use another path. A workspace with several graphs adds the graph id before `.json`.

The file holds the model, the size of the vectors, and for each node the hash of its text and its vector. The vector has 4 decimals and length 1. A rerun embeds only the new nodes and the nodes whose hash changed, and drops the nodes that no longer exist. A change of `model`, `dimensions` or a prefix embeds all nodes again.

A model with Matryoshka training, for example EmbeddingGemma or nomic-embed-text v1.5, keeps its meaning when the vector is cut. Set `dimensions` to a smaller number to get a smaller file.

Add the index file to `.gitignore` or commit it. The choice is yours.

## Search

```
semspec search --workspace workspace.yaml "<query>" [--mode keyword|hybrid|vector]
```

The MCP tool `search` has the same input `mode`.

- `keyword`: the keyword ranking only.
- `vector`: the ranking by cosine only. At most 50 nodes.
- `hybrid`: both rankings, merged with reciprocal rank fusion, with k = 60. An exact id or title match stays first.

The default is `hybrid` when the graph has an index, and `keyword` when it has none. When the model does not answer, or the index does not fit the setting, the search uses keywords only and the result has a `notes` list with the reason. A node that changed after the last `semspec index` has no vector, and a note says so.

## Measure

`npm run eval:search -- --workspace <file>` prints recall at 5 and MRR of the keyword ranking and the hybrid ranking, with the model that you configured. The questions come from `--set` (default `requirements/search-eval.yaml`). `--workspace`, or `--graph` and `--profile`, replace the graphs of the set. Build the index first.

The tests of the repository use a fake provider with no model. Their numbers measure the code path, not the quality of a model.

## Example models

Semspec does not test, ship or download these models. Check the model card for the current licence and for the prefixes.

| Model | Licence | Notes |
| --- | --- | --- |
| EmbeddingGemma | Gemma Terms of Use, not an OSI licence | 768 numbers, can be cut to 512, 256 or 128. Expects prompt prefixes, see the model card. |
| bge-small-en-v1.5 | MIT | 384 numbers, English. The retrieval query has an instruction prefix, see the model card. |
| multilingual-e5-small | MIT | 384 numbers, many languages. Use `query: ` before the query and `passage: ` before the text. |
| nomic-embed-text v1.5 | Apache 2.0 | 768 numbers, can be cut. Use `search_query: ` before the query and `search_document: ` before the text. |

You accept the licence of the model that you use. Semspec does not ship any model.
