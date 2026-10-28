#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { run } from '../dist/cli/index.js';

process.exit(await run(process.argv.slice(2)));
