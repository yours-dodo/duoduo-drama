import type { JsonValue, ToolCallContent } from './content.js';
import type { ToolDefinition } from './messages.js';

export interface JsonSchema {
  readonly [keyword: string]: JsonValue;
}

export interface ToolValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}

export type JsonParseResult =
  | Readonly<{ ok: true; value: JsonValue; repaired: boolean }>
  | Readonly<{ ok: false; error: 'invalid_json' | 'too_large' }>;

export type ToolValidationResult =
  | Readonly<{ valid: true; value: JsonValue }>
  | Readonly<{ valid: false; issues: readonly ToolValidationIssue[] }>;

export function parseToolArguments(
  rawArguments: string,
  options: { maxBytes?: number; repairTruncatedJson?: boolean } = {},
): JsonParseResult {
  if (
    new TextEncoder().encode(rawArguments).byteLength >
    (options.maxBytes ?? 1_000_000)
  )
    return { ok: false, error: 'too_large' };

  try {
    return {
      ok: true,
      value: JSON.parse(rawArguments) as JsonValue,
      repaired: false,
    };
  } catch {
    if (!options.repairTruncatedJson)
      return { ok: false, error: 'invalid_json' };
    const repaired = repairTruncatedJson(rawArguments);
    if (repaired === undefined) return { ok: false, error: 'invalid_json' };
    try {
      return {
        ok: true,
        value: JSON.parse(repaired) as JsonValue,
        repaired: true,
      };
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  }
}

/** Repair only the safe, syntactically recoverable suffix of a truncated JSON value. */
function repairTruncatedJson(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let output = '';
  for (const char of trimmed) {
    output += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.at(-1) !== expected) return undefined;
      stack.pop();
    }
  }
  if (escaped) output += '\\';
  if (inString) output += '"';

  // A dangling comma is the one common truncation that cannot be closed directly.
  output = output.replace(/,\s*$/, '');
  output = output.replace(/,\s*([}\]])$/, '$1');
  while (stack.length > 0) output += stack.pop() === '{' ? '}' : ']';
  return output;
}

export function validateToolArguments(
  tool: ToolDefinition,
  argumentsValue: JsonValue,
): ToolValidationResult {
  const schema = tool.inputSchema;
  const issues: ToolValidationIssue[] = [];
  if (!isSchemaObject(schema)) {
    return {
      valid: false,
      issues: [
        {
          instancePath: '',
          keyword: 'schema',
          message: 'inputSchema must be a JSON schema object',
        },
      ],
    };
  }
  validateSchema(schema, argumentsValue, '', issues);
  return issues.length === 0
    ? { valid: true, value: argumentsValue }
    : { valid: false, issues };
}

export function validateToolCall(
  tools: readonly ToolDefinition[],
  call: ToolCallContent,
): ToolValidationResult {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool)
    return {
      valid: false,
      issues: [{ instancePath: '', keyword: 'tool', message: 'unknown tool' }],
    };
  if (call.status !== 'complete' || call.arguments === undefined) {
    return {
      valid: false,
      issues: [
        {
          instancePath: '',
          keyword: 'arguments',
          message: 'tool call arguments are incomplete',
        },
      ],
    };
  }
  return validateToolArguments(tool, call.arguments);
}

function isSchemaObject(
  value: unknown,
): value is JsonValue & { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSchema(
  schema: JsonValue & { readonly [key: string]: JsonValue },
  value: JsonValue,
  path: string,
  issues: ToolValidationIssue[],
): void {
  const type = schema.type;
  if (typeof type === 'string' && !matchesType(type, value)) {
    issues.push({
      instancePath: path,
      keyword: 'type',
      message: `must be ${type}`,
    });
    return;
  }

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => deepEqual(candidate, value))
  )
    issues.push({
      instancePath: path,
      keyword: 'enum',
      message: 'must be equal to one of the allowed values',
    });

  if (typeof schema.const !== 'undefined' && !deepEqual(schema.const, value))
    issues.push({
      instancePath: path,
      keyword: 'const',
      message: 'must be equal to the constant value',
    });

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      issues.push({
        instancePath: path,
        keyword: 'minLength',
        message: `must NOT have fewer than ${schema.minLength} characters`,
      });
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      issues.push({
        instancePath: path,
        keyword: 'maxLength',
        message: `must NOT have more than ${schema.maxLength} characters`,
      });
    if (typeof schema.pattern === 'string') {
      let matches = false;
      try {
        matches = new RegExp(schema.pattern).test(value);
      } catch {
        matches = false;
      }
      if (!matches)
        issues.push({
          instancePath: path,
          keyword: 'pattern',
          message: 'must match pattern',
        });
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      issues.push({
        instancePath: path,
        keyword: 'minimum',
        message: `must be >= ${schema.minimum}`,
      });
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      issues.push({
        instancePath: path,
        keyword: 'maximum',
        message: `must be <= ${schema.maximum}`,
      });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      issues.push({
        instancePath: path,
        keyword: 'minItems',
        message: `must NOT have fewer than ${schema.minItems} items`,
      });
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      issues.push({
        instancePath: path,
        keyword: 'maxItems',
        message: `must NOT have more than ${schema.maxItems} items`,
      });
    const itemSchema = schema.items;
    if (isSchemaObject(itemSchema))
      value.forEach((item, index) =>
        validateSchema(itemSchema, item, `${path}/${index}`, issues),
      );
  }
  if (isSchemaObject(value)) {
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value))
          issues.push({
            instancePath: path,
            keyword: 'required',
            message: `must have required property '${key}'`,
          });
      }
    }
    const propertiesValue = schema.properties;
    const properties = isSchemaObject(propertiesValue)
      ? propertiesValue
      : undefined;
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in value && isSchemaObject(childSchema))
          validateSchema(
            childSchema,
            value[key]!,
            `${path}/${escapeJsonPointer(key)}`,
            issues,
          );
      }
    }
    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(value))
        if (!(key in properties))
          issues.push({
            instancePath: `${path}/${escapeJsonPointer(key)}`,
            keyword: 'additionalProperties',
            message: 'must NOT have additional properties',
          });
    }
  }
}

function matchesType(type: string, value: JsonValue): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (type === 'integer')
    return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
