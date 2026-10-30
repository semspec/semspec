---
id: schemas
kind: reference
title: The schemas of the kinds
description: Write a JSON Schema for each kind of a profile.
order: 3
related: [profile, cli]
documents: [cap-schemas, req-schema-per-kind, req-schema-fields]
---
`semspec schema --profile profile.json --out schemas` writes `schemas/<kind id>.schema.json` for each kind. Each file is a JSON Schema (draft 2020-12) that holds only what the profile knows: the id with the prefix of the kind, the kind, the title, statement and lifecycle fields, the parent and link fields, the refs, the parts, the checks and the status. The schema allows other fields. An editor can use the schemas to check the YAML files.
