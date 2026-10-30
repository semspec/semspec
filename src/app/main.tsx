// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './App';
import type { WorkspaceData } from '@core/index';
import type { Model } from './lib/core';

const data = document.getElementById('graph-data');
if (!data || !data.textContent) throw new Error('The page has no graph data');
const parsed = JSON.parse(data.textContent) as Model | WorkspaceData;
// A page of 1 graph holds the model. It becomes a workspace of 1 graph.
const workspace: WorkspaceData = 'graphs' in parsed ? parsed : { title: parsed.profile.project, graphs: [{ id: 'main', label: parsed.profile.project, model: parsed }] };
createRoot(document.getElementById('root')!).render(<App data={workspace} />);
