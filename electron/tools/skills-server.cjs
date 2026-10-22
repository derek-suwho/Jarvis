// Stdio MCP server that gives Claude Code the skills imported into Jarvis.
// Run as: ELECTRON_RUN_AS_NODE=1 <electron> skills-server.cjs <skills.json>
const fs = require('node:fs');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { skillTools } = require('./skills.cjs');

const skills = () => {
  try {
    return JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  } catch {
    return [];
  }
};

const server = new Server({ name: 'jarvis-skills', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: skillTools(skills()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, (req) => {
  const tool = skillTools(skills()).find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }], isError: true };
  return { content: [{ type: 'text', text: tool.run(req.params.arguments) }] };
});
server.connect(new StdioServerTransport());
