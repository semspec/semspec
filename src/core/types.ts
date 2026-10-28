// SPDX-License-Identifier: Apache-2.0
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
  citations?: {
    kind: string;
    title: string;
    rows: { label: string; path: string; template?: string; link?: boolean }[];
    anchor?: string;
    url?: string;
  }[];
}

export interface Profile {
  // The name of the project, shown as secondary text.
  project: string;
  source: { nodes: string; id: string; kind: string };
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
  refs?: { field: string; target: string; note: string };
  supersededBy?: string;
  linkedScopeEdges?: string[];
  parts?: PartSpec[];
  checks?: CheckSpec;
  facets?: { groupKind: string; groupLabel: string };
  entry?: { kind: string; childKind: string; title: string; countLabel: string };
  groups?: { hierarchy: string };
  details?: DetailsSpec;
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
  // The fields of the graph node that the details panel reads.
  d: Record<string, any>;
}

export interface VEdge {
  s: string;
  t: string;
  k: string;
  n?: string;
}

export interface Model {
  profile: Profile;
  nodes: VNode[];
  edges: VEdge[];
  unresolved: { s: string; t: string; k: string }[];
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
  model: Model;
  moduleCache: Map<string, Set<string>>;
  unplaced: Set<string>;
}

export interface Filters {
  q: string;
  kinds: string[];
  lifecycles: string[];
  deliveries: string[];
  modules: string[];
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

export interface Groups {
  edge: { k: string; dir: 'in' | 'out'; count: number }[];
  kind: { kind: string; count: number }[];
  total: number;
}
