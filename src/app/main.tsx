// SPDX-License-Identifier: Apache-2.0
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './App';
import { setProfile, type Model } from './lib/core';

const data = document.getElementById('graph-data');
if (!data || !data.textContent) throw new Error('The page has no graph data');
const model = JSON.parse(data.textContent) as Model;
setProfile(model.profile);
createRoot(document.getElementById('root')!).render(<App model={model} />);
