#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server/server.js";

const projectRoot = process.cwd();
const server = createServer(projectRoot);

const transport = new StdioServerTransport();
await server.connect(transport);
