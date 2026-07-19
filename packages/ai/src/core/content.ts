export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ReplayMetadata {
  readonly version: 1;
  readonly scope: 'portable' | 'same-provider' | 'same-model';
  readonly source?: ModelRef;
  readonly protocolId: string;
  readonly codecId: string;
  readonly codecVersion: number;
  readonly data: JsonValue;
}

export interface TextContent {
  readonly type: 'text';
  readonly text: string;
  readonly replay?: ReplayMetadata;
}

export interface ReasoningContent {
  readonly type: 'reasoning';
  readonly text?: string;
  readonly replay?: ReplayMetadata;
}

export interface ImageContent {
  readonly type: 'image';
  readonly mediaType: string;
  readonly source:
    | { readonly type: 'url'; readonly url: string }
    | { readonly type: 'base64'; readonly data: string };
}

export interface ToolCallContent {
  readonly type: 'tool_call';
  readonly id: string;
  readonly name: string;
  readonly status: 'complete' | 'incomplete';
  readonly rawArguments: string;
  readonly arguments?: JsonValue;
  readonly replay?: ReplayMetadata;
}

import type { ModelRef } from './models.js';
