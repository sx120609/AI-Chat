import assert from "node:assert/strict";
import test from "node:test";
import {
  anthropicStreamEventsFromChat,
  anthropicRequestToChat,
  anthropicResponseFromChat,
  createAnthropicStreamState,
  createGeminiStreamState,
  geminiRequestToChat,
  geminiResponseFromChat,
  geminiStreamChunkFromChat
} from "./protocol-compat";

test("converts Anthropic messages, images and tools to GPT Chat Completions", () => {
  const converted = anthropicRequestToChat(
    {
      model: "claude-sonnet-4-5",
      system: "Follow the tool contract.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" }
            }
          ]
        }
      ],
      tools: [
        {
          name: "lookup",
          description: "Look up an item",
          input_schema: { type: "object", properties: { id: { type: "string" } } }
        }
      ],
      tool_choice: { type: "any" },
      max_tokens: 100
    },
    "gpt-5.6-sol"
  );

  assert.equal(converted.model, "gpt-5.6-sol");
  assert.equal((converted.messages as Array<{ role: string }>)[0]?.role, "system");
  assert.equal((converted.tools as unknown[]).length, 1);
  assert.equal(converted.tool_choice, "required");
  assert.match(JSON.stringify(converted), /data:image\/png;base64,AAAA/);
});

test("converts GPT tool calls back to Anthropic tool_use blocks", () => {
  const response = anthropicResponseFromChat(
    {
      id: "chatcmpl_1",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"id":"42"}' }
              }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 }
    },
    "claude-sonnet-4-5"
  );

  assert.equal(response.stop_reason, "tool_use");
  assert.deepEqual(response.content[0], {
    type: "tool_use",
    id: "call_1",
    name: "lookup",
    input: { id: "42" }
  });
});

test("converts Gemini native content and function declarations to and from GPT", () => {
  const converted = geminiRequestToChat(
    {
      systemInstruction: { parts: [{ text: "Be concise" }] },
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      tools: [
        {
          functionDeclarations: [
            { name: "weather", parameters: { type: "object", properties: {} } }
          ]
        }
      ]
    },
    "gpt-5.6-sol"
  );
  const response = geminiResponseFromChat(
    {
      id: "chatcmpl_2",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content: "Hi" } }
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1 }
    },
    "gpt-5.6-sol"
  );

  assert.equal((converted.messages as Array<{ role: string }>)[0]?.role, "system");
  assert.equal((converted.tools as unknown[]).length, 1);
  assert.deepEqual(response.candidates[0]?.content.parts, [{ text: "Hi" }]);
  assert.equal(response.usageMetadata.totalTokenCount, 4);
});

test("converts fragmented GPT streaming tool calls to valid protocol events", () => {
  const anthropicState = createAnthropicStreamState(9);
  const anthropicStart = anthropicStreamEventsFromChat(
    {
      id: "chatcmpl_stream",
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"id":' } }
            ]
          },
          finish_reason: null
        }
      ]
    },
    "claude-sonnet-4-5",
    anthropicState
  );
  const anthropicEnd = anthropicStreamEventsFromChat(
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '"42"}' } }] },
          finish_reason: "tool_calls"
        }
      ],
      usage: { prompt_tokens: 9, completion_tokens: 5 }
    },
    "claude-sonnet-4-5",
    anthropicState
  );

  assert.equal(
    (anthropicStart[0]?.data.message as { usage: { input_tokens: number } }).usage.input_tokens,
    9
  );
  assert.equal(anthropicEnd.at(-1)?.event, "message_stop");

  const geminiState = createGeminiStreamState();
  const geminiStart = geminiStreamChunkFromChat(
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"id":' } }
            ]
          },
          finish_reason: null
        }
      ]
    },
    geminiState
  );
  const geminiEnd = geminiStreamChunkFromChat(
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '"42"}' } }] },
          finish_reason: "tool_calls"
        }
      ]
    },
    geminiState
  );

  assert.deepEqual(geminiStart?.candidates[0]?.content.parts, []);
  assert.deepEqual(geminiEnd?.candidates[0]?.content.parts, [
    { functionCall: { id: "call_1", name: "lookup", args: { id: "42" } } }
  ]);
});
