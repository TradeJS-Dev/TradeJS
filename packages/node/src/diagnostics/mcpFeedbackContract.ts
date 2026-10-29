/** Version of the complete feedback read contract, independent of package versions. */
export const MCP_FEEDBACK_CONTRACT = {
  version: 1,
  hostProtocolVersion: 2,
  replayQueue: {
    waitingStates: ['waiting_resources', 'waiting_executor'],
    automaticFailedRetries: false,
  },
  artifactEncoding: 'base64',
  maximumChunkBytes: 48000,
  artifactFiles: ['payload', 'manifest.json', '.complete', 'replay.log'],
  requiredTools: [
    'tradejs_info',
    'diagnostics_list_reports',
    'diagnostics_get_report',
    'artifact_get',
    'job_get',
    'job_get_logs',
  ],
} as const;

export type McpToolDescription = {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
};

/** Check the actual client's tools/list, not only what the server advertises. */
export const assertMcpFeedbackContract = (
  version: unknown,
  tools: McpToolDescription[],
) => {
  if (version !== MCP_FEEDBACK_CONTRACT.version)
    throw new Error('MCP feedback contract version mismatch');
  for (const name of MCP_FEEDBACK_CONTRACT.requiredTools)
    if (!tools.some((tool) => tool.name === name))
      throw new Error(`MCP feedback requires tool ${name}`);
  const properties = tools.find((tool) => tool.name === 'artifact_get')
    ?.inputSchema.properties;
  if (!properties || !('file' in properties))
    throw new Error(
      'MCP feedback requires artifact_get.file; refresh the client tool schema',
    );
};
