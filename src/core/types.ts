// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The types of the 2 inputs, the profile and the graph, and of the model that the page reads.

export type Role = 'hierarchy' | 'part' | 'linked' | 'check';

// A chip of a node summary. A string names a built-in chip. An object reads a field of the node.
export type ChipSpec =
  | 'lifecycle'
  | 'members'
  | 'coverage'
  | 'verified'
  | 'verifyTypes'
  | 'checkType'
  | { field: string; format?: 'upper'; tone?: ChipTone; template?: string; slice?: number };

export type ChipTone = 'life' | 'muted' | 'count' | 'level' | 'good' | 'warn' | 'plain';

export interface CitationSpec {
  source: string;
  // A dotted path to the display name of the source. A value at the path is the name as written.
  name?: string;
  subtitle?: string;
  parts: { field: string; prefix?: string; wrap?: string }[];
}

export interface KindSpec {
  id: string;
  label: string;
  plural: string;
  prefix?: string;
  role: Role;
  color: { light: string; dark: string };
  // Groups of parent fields. The first group that names a node places the node in the tree.
  parents?: string[][];
  placedUnder?: string;
  unplacedLabel?: string;
  citation?: CitationSpec;
  chips?: ChipSpec[];
}

export interface PartSpec {
  kind: string;
  owner: string;
  field: string;
  id: string;
  text: string;
  idPrefixPattern?: string;
  setup?: string;
  scope?: string;
  edge: string;
  sectionTitle?: string;
}

// An object in a node of the owner kind that is a node of its own. 1 node of `kind` is made for
// each distinct value of `id`. The owner gets `edge` to the new node, and `edge` is a parent field.
export interface EmbeddedSpec {
  owner: string;
  // A dotted path to the object in the owner.
  field: string;
  kind: string;
  // The key of the id inside the object. An object needs it. A string or a number in `field` is
  // the id itself, and the new node has no other field.
  id?: string;
  edge: string;
}

export interface CheckTypeSpec {
  key: string[];
  title: string[];
  titlePrefix?: string;
}

export interface CheckSpec {
  kind: string;
  field: string;
  edge: string;
  typeField: string;
  types?: Record<string, CheckTypeSpec>;
  // The fields that the details panel shows for a check.
  detail?: { name: string[]; file?: string; record?: string };
  sectionTitle?: string;
  noneText?: string;
}

// A status that a node carries in 1 field, for example the result of a review. A node with no
// status of its own gets the status of the nodes below it. Each value has a tone: `good`, `warn`
// or `bad`. The profile names exactly 1 value of each tone.
export interface StatusSpec {
  label: string;
  field: string;
  values: { value: string; label: string; tone: StatusTone }[];
  // A list field of a node with a status. The details panel shows it next to the status.
  detail?: { field: string; label: string };
}

export type StatusTone = 'good' | 'warn' | 'bad';

// A filter on a list field or a text field of a node.
export interface FieldFilterSpec {
  field: string;
  label: string;
  // A label for a value. A value with no label shows as it is.
  values?: Record<string, string>;
  // The picker groups the values by the text before the first separator.
  groupBy?: string;
  // `keys` takes the values from the keys of the objects in the list field.
  from?: 'keys';
}

export interface PropertySpec {
  label: string;
  field: string;
  format?: 'upper' | 'list' | 'code' | 'yesno';
}

export interface DetailsSpec {
  properties?: PropertySpec[];
  statementTitle?: Record<string, string>;
  textSections?: { title: string; field: string; kinds?: string[] }[];
  optionSections?: { title: string; field: string; primary: string; secondary: string; secondaryPrefix?: string }[];
  sourceSections?: { title: string; field: string; name: string; section?: string; url?: string; retrieved?: string }[];
  objectLists?: { title: string; field: string; badge: string; value: string[]; suffix?: string; suffixSeparator?: string }[];
  // A list of tagged objects, 1 key each. `labels` maps "<tag>.<key>" and "<tag>" to a label.
  taggedLists?: { title: string; field: string; labels?: Record<string, string> }[];
  citations?: {
    kind: string;
    title: string;
    rows: { label: string; path: string; template?: string; link?: boolean }[];
    anchor?: string;
    url?: string;
  }[];
}

// A field that points into another graph of the workspace. The field holds a list of node ids
// of the target graph. `graph` is the id of the target graph in the workspace file.
export interface CrossLinkSpec {
  field: string;
  graph: string;
  label: string;
}

// One refs field. `target` is the key of the node id in an item and `note` is the key of the edge
// note. `many` is the key of a boolean in an item. When it is true, the note gets the suffix `[]`.
export interface RefsSpec {
  field: string;
  target: string;
  note: string;
  many?: string;
}

// A profile as a file holds it: `refs` is 1 entry or a list.
export type ProfileInput = Omit<Profile, 'refs'> & { refs?: RefsSpec | RefsSpec[] };

export interface Profile {
  // The name of the project, shown as secondary text.
  project: string;
  // `defaultKind` is the kind of a node with no value in the `kind` key.
  source: { nodes: string; id: string; kind: string; defaultKind?: string };
  fields: { title: string[]; idPrefixPattern?: string; statement: string[]; level?: string; delivery?: string; decided?: string };
  lifecycle: {
    field: string;
    fallback: string;
    byKind?: Record<string, string>;
    states?: Record<string, { muted?: boolean }>;
  };
  kinds: KindSpec[];
  // Edge fields. `labels` is [reading from the source, reading from the target].
  // `down` marks an edge whose target is the more general node.
  edges: Record<string, { labels: [string, string]; down?: boolean }>;
  links?: string[];
  // Links into other graphs. They are not edges of this graph.
  crossLinks?: CrossLinkSpec[];
  // Fields that hold a list of objects, each with the id of a node and a note. A profile file holds
  // 1 entry or a list of entries. `normalise` makes the list.
  refs?: RefsSpec[];
  supersededBy?: string;
  linkedScopeEdges?: string[];
  parts?: PartSpec[];
  embedded?: EmbeddedSpec[];
  checks?: CheckSpec;
  status?: StatusSpec;
  fieldFilters?: FieldFilterSpec[];
  facets?: { groupKind: string; groupLabel: string };
  entry?: { kind: string; childKind: string; title: string; countLabel: string };
  groups?: { hierarchy: string };
  details?: DetailsSpec;
  // The layout of the Graph and Cards views. `groupEdge` names the edge whose target is the container of its source.
  layout?: { default?: 'layered' | 'grouped' | 'force'; groupEdge?: string };
}

// A graph is a list of nodes. Each node has an id, a kind and any other fields.
// The profile says which fields name other nodes.
export type RawNode = { id?: string; [field: string]: unknown };
export type Graph = { [key: string]: unknown };

export interface VNode {
  id: string;
  kind: string;
  title: string;
  sub: string;
  lifecycle: string;
  delivery: string;
  level: string;
  statement: string;
  parents: string[];
  up: string[];
  cov?: { parts: number; verified: number };
  // The status value of the node itself, when the profile has a status and the node names a known value.
  status?: string;
  // The fields of the graph node that the details panel reads.
  d: Record<string, any>;
}

export interface VEdge {
  s: string;
  t: string;
  k: string;
  n?: string;
}

// A link from a node of this graph to a node of another graph. `t` may name no node.
export interface CrossLink {
  s: string;
  field: string;
  graph: string;
  t: string;
}

export interface Model {
  profile: Profile;
  nodes: VNode[];
  edges: VEdge[];
  unresolved: { s: string; t: string; k: string }[];
  // The links to other graphs, in the order of the nodes and of the profile.
  crossLinks: CrossLink[];
  unplaced: string[];
  stats: { unplaced: number; unplacedLive: number };
  disclosure: Record<string, unknown>;
  problems: number;
}

export interface Index {
  profile: Profile;
  byId: Map<string, VNode>;
  children: Map<string, string[]>;
  scopeChildren: Map<string, string[]>;
  out: Map<string, VEdge[]>;
  inc: Map<string, VEdge[]>;
  // The outgoing cross links of each node.
  crossOut: Map<string, CrossLink[]>;
  model: Model;
  moduleCache: Map<string, Set<string>>;
  statusCache: Map<string, Set<string>>;
  carrierCache: Map<string, Set<string>>;
  fieldCache: Map<string, Map<string, boolean>>;
  unplaced: Set<string>;
}

export interface Filters {
  q: string;
  kinds: string[];
  lifecycles: string[];
  deliveries: string[];
  modules: string[];
  statuses: string[];
  // The selected values of each field filter, by field. '' selects the nodes without a value.
  fields?: Record<string, string[]>;
}

export interface Walk {
  shown: Set<string>;
  intro: Map<string, Set<string>>;
}

export interface Chip {
  text: string;
  tone: ChipTone;
  struck?: boolean;
}

export interface Summary {
  kind: string;
  title: string;
  sub: string;
  id: string;
  muted: boolean;
  chips: Chip[];
}

// The status of a node: its own value, or the roll-up of the nodes below it.
// `counts` holds the number of nodes with a status of their own, for each value.
// `value` is null when no node with a status is below the node.
export interface NodeStatus {
  value: string | null;
  tone: StatusTone | null;
  counts: Record<string, number>;
  total: number;
}

export interface Groups {
  edge: { k: string; dir: 'in' | 'out'; count: number }[];
  kind: { kind: string; count: number }[];
  total: number;
}
