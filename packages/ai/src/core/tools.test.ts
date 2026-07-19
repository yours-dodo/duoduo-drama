import { describe, expect, it } from 'vitest';
import type { ToolCallContent } from './content.js';
import type { ToolDefinition } from './messages.js';
import { parseToolArguments, validateToolCall } from './tools.js';
import { validateContext } from './context.js';

const lookupTool: ToolDefinition = {
  name: 'lookup',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string', minLength: 2 } },
    required: ['q'],
    additionalProperties: false,
  },
};

describe('tool helpers', () => {
  it('repairs truncated JSON but still requires schema validation', () => {
    const parsed = parseToolArguments('{"q":"x"', {
      repairTruncatedJson: true,
    });
    expect(parsed).toEqual({ ok: true, value: { q: 'x' }, repaired: true });
    if (!parsed.ok) throw new Error('expected repaired JSON');
    const call: ToolCallContent = {
      type: 'tool_call',
      id: 'call-1',
      name: 'lookup',
      status: 'complete',
      rawArguments: '{"q":"x"',
      arguments: parsed.value,
    };
    expect(validateToolCall([lookupTool], call)).toMatchObject({
      valid: false,
      issues: [{ instancePath: '/q', keyword: 'minLength' }],
    });
  });

  it('repairs a truncated object after a dangling comma', () => {
    expect(
      parseToolArguments('{"q":"query",', {
        repairTruncatedJson: true,
      }),
    ).toEqual({ ok: true, value: { q: 'query' }, repaired: true });
  });

  it('never treats an incomplete tool call as executable', () => {
    expect(
      validateToolCall([lookupTool], {
        type: 'tool_call',
        id: 'call-1',
        name: 'lookup',
        status: 'incomplete',
        rawArguments: '{"q":',
      }),
    ).toMatchObject({
      valid: false,
      issues: [{ keyword: 'arguments' }],
    });
  });

  it('rejects duplicate tool names before provider execution', () => {
    expect(
      validateContext({ messages: [], tools: [lookupTool, lookupTool] }),
    ).toMatchObject({
      valid: false,
      issues: [{ code: 'duplicate_tool' }],
    });
  });
});
