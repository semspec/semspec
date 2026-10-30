#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { run } from '../packages/cli/dist/index.js';

process.exit(await run(process.argv.slice(2)));
