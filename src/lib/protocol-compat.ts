type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }

  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    return objectValue(JSON.parse(value)) ?? {};
  } catch {
    return { value };
  }
}

function joinTextParts(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return arrayValue(value)
    .map((item) => {
      const object = objectValue(item);
      return textValue(object?.text) || textValue(object?.content) || textValue(item);
    })
    .filter(Boolean)
    .join("\n");
}

function anthropicImagePart(part: JsonObject) {
  const source = objectValue(part.source);

  if (!source) {
    return null;
  }

  const sourceType = textValue(source.type);
  const mediaType = textValue(source.media_type) || "image/png";
  const data = textValue(source.data);
  const url = textValue(source.url);
  const imageUrl = sourceType === "base64" && data ? `data:${mediaType};base64,${data}` : url;

  return imageUrl
    ? { type: "image_url", image_url: { url: imageUrl } }
    : null;
}

function anthropicUserContentParts(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  const parts: JsonObject[] = [];

  for (const item of arrayValue(content)) {
    const part = objectValue(item);

    if (!part) {
      continue;
    }

    if (part.type === "text") {
      parts.push({ type: "text", text: textValue(part.text) });
      continue;
    }

    if (part.type === "image") {
      const image = anthropicImagePart(part);

      if (image) {
        parts.push(image);
      }
    }
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return textValue(parts[0].text);
  }

  return parts;
}

function anthropicMessagesToChat(messages: unknown) {
  const result: JsonObject[] = [];

  for (const item of arrayValue(messages)) {
    const message = objectValue(item);

    if (!message) {
      continue;
    }

    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks = arrayValue(message.content);

    if (role === "assistant" && blocks.length) {
      const content = blocks
        .filter((block) => objectValue(block)?.type === "text")
        .map((block) => textValue(objectValue(block)?.text))
        .join("\n");
      const toolCalls = blocks.flatMap((block) => {
        const value = objectValue(block);

        if (!value || value.type !== "tool_use") {
          return [];
        }

        return [{
          id: textValue(value.id) || `call_${result.length}_${Date.now()}`,
          type: "function",
          function: {
            name: textValue(value.name),
            arguments: JSON.stringify(objectValue(value.input) ?? {})
          }
        }];
      });

      result.push({
        role,
        content: content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      });
      continue;
    }

    if (role === "user" && blocks.length) {
      for (const block of blocks) {
        const value = objectValue(block);

        if (value?.type === "tool_result") {
          result.push({
            role: "tool",
            tool_call_id: textValue(value.tool_use_id),
            content: joinTextParts(value.content)
          });
        }
      }

      const content = anthropicUserContentParts(
        blocks.filter((block) => objectValue(block)?.type !== "tool_result")
      );

      if ((typeof content === "string" && content) || (Array.isArray(content) && content.length)) {
        result.push({ role, content });
      }
      continue;
    }

    result.push({ role, content: anthropicUserContentParts(message.content) });
  }

  return result;
}

function anthropicToolsToChat(tools: unknown) {
  return arrayValue(tools).flatMap((item) => {
    const tool = objectValue(item);

    if (!tool || !textValue(tool.name)) {
      return [];
    }

    return [{
      type: "function",
      function: {
        name: textValue(tool.name),
        description: textValue(tool.description),
        parameters: objectValue(tool.input_schema) ?? { type: "object", properties: {} }
      }
    }];
  });
}

export function anthropicRequestToChat(body: JsonObject, upstreamModel: string) {
  const messages = anthropicMessagesToChat(body.messages);
  const system = joinTextParts(body.system);
  const tools = anthropicToolsToChat(body.tools);
  const toolChoice = objectValue(body.tool_choice);
  const toolChoiceType = textValue(toolChoice?.type);
  let normalizedToolChoice: unknown;

  if (toolChoiceType === "any") {
    normalizedToolChoice = "required";
  } else if (toolChoiceType === "tool" && textValue(toolChoice?.name)) {
    normalizedToolChoice = {
      type: "function",
      function: { name: textValue(toolChoice?.name) }
    };
  } else if (toolChoiceType === "auto" || toolChoiceType === "none") {
    normalizedToolChoice = toolChoiceType;
  }

  return {
    model: upstreamModel,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages
    ],
    stream: body.stream === true,
    ...(typeof body.max_tokens === "number" ? { max_tokens: body.max_tokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(Array.isArray(body.stop_sequences) ? { stop: body.stop_sequences } : {}),
    ...(tools.length ? { tools } : {}),
    ...(normalizedToolChoice ? { tool_choice: normalizedToolChoice } : {}),
    ...(body.stream === true ? { stream_options: { include_usage: true } } : {})
  } satisfies JsonObject;
}

function openAiUsage(payload: unknown) {
  const usage = objectValue(objectValue(payload)?.usage);

  return {
    input_tokens: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0,
    output_tokens: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0
  };
}

function openAiChoice(payload: unknown) {
  return objectValue(arrayValue(objectValue(payload)?.choices)[0]);
}

export function anthropicResponseFromChat(payload: unknown, requestedModel: string) {
  const root = objectValue(payload) ?? {};
  const choice = openAiChoice(root) ?? {};
  const message = objectValue(choice.message) ?? {};
  const content: JsonObject[] = [];
  const text = joinTextParts(message.content);

  if (text) {
    content.push({ type: "text", text });
  }

  for (const item of arrayValue(message.tool_calls)) {
    const call = objectValue(item);
    const fn = objectValue(call?.function);

    if (!call || !fn) {
      continue;
    }

    content.push({
      type: "tool_use",
      id: textValue(call.id),
      name: textValue(fn.name),
      input: parseJsonObject(fn.arguments)
    });
  }

  const finishReason = textValue(choice.finish_reason);

  return {
    id: textValue(root.id) || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason:
      finishReason === "tool_calls"
        ? "tool_use"
        : finishReason === "length"
          ? "max_tokens"
          : "end_turn",
    stop_sequence: null,
    usage: openAiUsage(root)
  };
}

function geminiPartToChat(part: JsonObject) {
  if (typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  const inlineData = objectValue(part.inlineData ?? part.inline_data);

  if (inlineData) {
    const mimeType = textValue(inlineData.mimeType ?? inlineData.mime_type) || "image/png";
    const data = textValue(inlineData.data);

    return data
      ? { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } }
      : null;
  }

  const fileData = objectValue(part.fileData ?? part.file_data);
  const fileUri = textValue(fileData?.fileUri ?? fileData?.file_uri);

  return fileUri ? { type: "image_url", image_url: { url: fileUri } } : null;
}

function geminiContentsToChat(contents: unknown) {
  const result: JsonObject[] = [];

  for (const item of arrayValue(contents)) {
    const content = objectValue(item);

    if (!content) {
      continue;
    }

    const role = content.role === "model" ? "assistant" : "user";
    const parts = arrayValue(content.parts);
    const functionCalls = parts.flatMap((part) => {
      const call = objectValue(objectValue(part)?.functionCall ?? objectValue(part)?.function_call);

      if (!call) {
        return [];
      }

      return [{
        id: textValue(call.id) || `call_${textValue(call.name) || result.length}`,
        type: "function",
        function: {
          name: textValue(call.name),
          arguments: JSON.stringify(objectValue(call.args) ?? {})
        }
      }];
    });
    const functionResponses = parts.flatMap((part) => {
      const response = objectValue(
        objectValue(part)?.functionResponse ?? objectValue(part)?.function_response
      );
      return response ? [response] : [];
    });

    if (functionResponses.length) {
      for (const response of functionResponses) {
        result.push({
          role: "tool",
          tool_call_id:
            textValue(response.id) || `call_${textValue(response.name) || result.length}`,
          content: JSON.stringify(response.response ?? {})
        });
      }
    }

    const chatParts = parts
      .map((part) => objectValue(part))
      .filter((part): part is JsonObject => Boolean(part))
      .map(geminiPartToChat)
      .filter((part): part is NonNullable<typeof part> => Boolean(part));
    const messageContent =
      chatParts.length === 1 && chatParts[0]?.type === "text"
        ? textValue(chatParts[0].text)
        : chatParts;

    if ((typeof messageContent === "string" && messageContent) || messageContent.length || functionCalls.length) {
      result.push({
        role,
        content: messageContent || null,
        ...(functionCalls.length ? { tool_calls: functionCalls } : {})
      });
    }
  }

  return result;
}

function geminiToolsToChat(tools: unknown) {
  return arrayValue(tools).flatMap((item) => {
    const tool = objectValue(item);
    const declarations = arrayValue(
      tool?.functionDeclarations ?? tool?.function_declarations
    );

    return declarations.flatMap((declaration) => {
      const fn = objectValue(declaration);

      if (!fn || !textValue(fn.name)) {
        return [];
      }

      return [{
        type: "function",
        function: {
          name: textValue(fn.name),
          description: textValue(fn.description),
          parameters: objectValue(fn.parameters) ?? { type: "object", properties: {} }
        }
      }];
    });
  });
}

export function geminiRequestToChat(body: JsonObject, upstreamModel: string, stream = false) {
  const generation = objectValue(body.generationConfig ?? body.generation_config) ?? {};
  const systemInstruction = objectValue(body.systemInstruction ?? body.system_instruction);
  const systemText = joinTextParts(systemInstruction?.parts);
  const tools = geminiToolsToChat(body.tools);

  return {
    model: upstreamModel,
    messages: [
      ...(systemText ? [{ role: "system", content: systemText }] : []),
      ...geminiContentsToChat(body.contents)
    ],
    stream,
    ...(typeof generation.maxOutputTokens === "number"
      ? { max_tokens: generation.maxOutputTokens }
      : {}),
    ...(typeof generation.temperature === "number"
      ? { temperature: generation.temperature }
      : {}),
    ...(typeof generation.topP === "number" ? { top_p: generation.topP } : {}),
    ...(Array.isArray(generation.stopSequences) ? { stop: generation.stopSequences } : {}),
    ...(tools.length ? { tools } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {})
  } satisfies JsonObject;
}

function geminiUsage(payload: unknown) {
  const usage = openAiUsage(payload);

  return {
    promptTokenCount: usage.input_tokens,
    candidatesTokenCount: usage.output_tokens,
    totalTokenCount: usage.input_tokens + usage.output_tokens
  };
}

export function geminiResponseFromChat(payload: unknown, requestedModel: string) {
  const choice = openAiChoice(payload) ?? {};
  const message = objectValue(choice.message) ?? {};
  const parts: JsonObject[] = [];
  const text = joinTextParts(message.content);

  if (text) {
    parts.push({ text });
  }

  for (const item of arrayValue(message.tool_calls)) {
    const call = objectValue(item);
    const fn = objectValue(call?.function);

    if (fn) {
      parts.push({
        functionCall: {
          id: textValue(call?.id),
          name: textValue(fn.name),
          args: parseJsonObject(fn.arguments)
        }
      });
    }
  }

  return {
    candidates: [{
      content: { role: "model", parts },
      finishReason: choice.finish_reason === "length" ? "MAX_TOKENS" : "STOP",
      index: 0
    }],
    usageMetadata: geminiUsage(payload),
    modelVersion: requestedModel,
    responseId: textValue(objectValue(payload)?.id) || `resp_${Date.now()}`
  };
}

export type GeminiStreamState = {
  toolCalls: Map<number, { arguments: string; id: string; name: string }>;
};

export function createGeminiStreamState(): GeminiStreamState {
  return { toolCalls: new Map() };
}

export function geminiStreamChunkFromChat(
  payload: unknown,
  state: GeminiStreamState = createGeminiStreamState()
) {
  const choice = openAiChoice(payload);
  const delta = objectValue(choice?.delta);
  const parts: JsonObject[] = [];
  const text = joinTextParts(delta?.content);

  if (text) {
    parts.push({ text });
  }

  for (const item of arrayValue(delta?.tool_calls)) {
    const call = objectValue(item);
    const fn = objectValue(call?.function);
    const index = Number(call?.index ?? 0) || 0;
    const previous = state.toolCalls.get(index) ?? { arguments: "", id: "", name: "" };

    if (call || fn) {
      state.toolCalls.set(index, {
        arguments: previous.arguments + textValue(fn?.arguments),
        id: textValue(call?.id) || previous.id,
        name: textValue(fn?.name) || previous.name
      });
    }
  }

  if (choice?.finish_reason && state.toolCalls.size) {
    for (const call of [...state.toolCalls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)) {
      parts.push({
        functionCall: {
          id: call.id,
          name: call.name,
          args: parseJsonObject(call.arguments)
        }
      });
    }

    state.toolCalls.clear();
  }

  const usage = objectValue(objectValue(payload)?.usage);

  if (!choice && !usage) {
    return null;
  }

  return {
    candidates: choice
      ? [{
          content: { role: "model", parts },
          ...(choice.finish_reason
            ? { finishReason: choice.finish_reason === "length" ? "MAX_TOKENS" : "STOP" }
            : {}),
          index: 0
        }]
      : [],
    ...(usage ? { usageMetadata: geminiUsage(payload) } : {})
  };
}

export type AnthropicStreamState = {
  inputTokens: number;
  nextBlockIndex: number;
  started: boolean;
  textBlockIndex: number | null;
  toolBlockIndexes: Map<number, number>;
};

export function createAnthropicStreamState(inputTokens = 0): AnthropicStreamState {
  return {
    inputTokens,
    nextBlockIndex: 0,
    started: false,
    textBlockIndex: null,
    toolBlockIndexes: new Map()
  };
}

export function anthropicStreamEventsFromChat(
  payload: unknown,
  requestedModel: string,
  state: AnthropicStreamState
) {
  const events: Array<{ event: string; data: JsonObject }> = [];
  const root = objectValue(payload) ?? {};

  if (!state.started) {
    state.started = true;
    events.push({
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: textValue(root.id) || `msg_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: requestedModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: openAiUsage(root).input_tokens || state.inputTokens,
            output_tokens: 0
          }
        }
      }
    });
  }

  const choice = openAiChoice(root);
  const delta = objectValue(choice?.delta);
  const text = joinTextParts(delta?.content);

  if (text) {
    if (state.textBlockIndex === null) {
      state.textBlockIndex = state.nextBlockIndex++;
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" }
        }
      });
    }

    events.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text }
      }
    });
  }

  for (const item of arrayValue(delta?.tool_calls)) {
    const call = objectValue(item);
    const fn = objectValue(call?.function);
    const toolIndex = Number(call?.index ?? 0) || 0;
    let blockIndex = state.toolBlockIndexes.get(toolIndex);

    if (blockIndex === undefined) {
      blockIndex = state.nextBlockIndex++;
      state.toolBlockIndexes.set(toolIndex, blockIndex);
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: blockIndex,
          content_block: {
            type: "tool_use",
            id: textValue(call?.id) || `call_${toolIndex}`,
            name: textValue(fn?.name),
            input: {}
          }
        }
      });
    }

    const partialJson = textValue(fn?.arguments);

    if (partialJson) {
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: partialJson }
        }
      });
    }
  }

  if (choice?.finish_reason) {
    const blockIndexes = [
      ...(state.textBlockIndex === null ? [] : [state.textBlockIndex]),
      ...state.toolBlockIndexes.values()
    ].sort((a, b) => a - b);

    for (const index of blockIndexes) {
      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index }
      });
    }

    const usage = openAiUsage(root);
    events.push({
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: {
          stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
          stop_sequence: null
        },
        usage: { output_tokens: usage.output_tokens }
      }
    });
    events.push({ event: "message_stop", data: { type: "message_stop" } });
  }

  return events;
}
