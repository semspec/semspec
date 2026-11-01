// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The types of the virtual modules that the Vite plugin in vite.config.ts provides.
declare module 'virtual:roadmap' {
  import type { RoadmapData } from '@/lib/roadmap';
  const data: RoadmapData;
  export default data;
}

declare module 'virtual:cards' {
  import type { FeatureCard } from '@/lib/cards';
  const data: FeatureCard[];
  export default data;
}

declare module 'virtual:trace' {
  import type { TraceData } from '@/lib/trace';
  const data: TraceData;
  export default data;
}

declare module 'virtual:hero-graph' {
  import type { HeroGraphData } from '@/lib/hero-graph';
  const data: HeroGraphData;
  export default data;
}

declare module 'virtual:snippets' {
  export interface Snippet {
    // The name shown in the top bar of the code block.
    file: string;
    // The plain text, for the copy button.
    code: string;
    // The highlighted HTML.
    html: string;
  }
  const data: { profile: Snippet; requirement: Snippet; shell: Snippet };
  export default data;
}

declare module 'virtual:build-info' {
  const info: { version: string; commit: string };
  export default info;
}

declare module 'virtual:docs' {
  import type { DocsIndex } from '@/lib/docs';
  const index: DocsIndex;
  export default index;
}

declare module 'virtual:doc-bodies' {
  // The HTML of each docs body, by page id.
  const bodies: Record<string, string>;
  export default bodies;
}
