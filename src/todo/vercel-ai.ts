import { serve } from "@hono/node-server";
import path, { resolve } from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  StreamData,
  tool,
  type CoreMessage,
} from "ai";
import { z } from "zod";
import type { NewToDoItem } from "./entities/todolist.js";
import {
  addItem,
  getList,
  markAdDone,
  removeItem,
} from "./persistence/todolist.js";
import { PdfReader } from "pdfreader";
import { stream, streamText as st } from "hono/streaming";
import * as fs from "fs";

const app = new Hono();
app.use("*", cors());

//const messages: CoreMessage[] = [];

const openai = createOpenAI({
  apiKey: "",
  compatibility: "strict", // strict mode, enable when using the OpenAI API
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const response = await RunAi(body.messages);
  // c.header("Content-Type", "application/octet-stream;");

  //return await c.text(response.text);
  return response.toDataStreamResponse();
  // return stream(c, async (stream) => {
  //   console.log(body);
  //   const response = await RunAi(body.messages);
  //   console.log(response);
  //   // c.header("Content-Type", "application/octet-stream;");

  //   await stream.pipe(response.textStream);
  // });
});

function RunAi(messages) {
  // messages.push({
  //   role: "user",
  //   content: message,
  // });
  const result = streamText({
    model: openai("gpt-4o", { structuredOutputs: true }),
    messages,
    system: `You are a helpful assistant. 
    Add or remove items provided by the user from todo list or execute requested actions on existing items items.
    As final answare return the entire list of the items
    `,
    tools: {
      addItem: tool({
        description: `Add item to the todo list.`,
        parameters: z.object({
          content: z.string().describe("Description of the to do list item"),
        }),
        execute: async ({ content }) => addItem({ description: content }),
      }),
      setAsDone: tool({
        description: `Set the list item as done.`,
        parameters: z.object({
          content: z
            .string()
            .describe("Description of the to do list item to set as done"),
        }),
        execute: async ({ content }) => markAdDone({ description: content }),
      }),
      removeItem: tool({
        description: `Remove item from the list.`,
        parameters: z.object({
          content: z
            .string()
            .describe("Description of the item to remove from the list"),
        }),
        execute: async ({ content }) => removeItem({ description: content }),
      }),
      findItems: tool({
        description: `Find all items in the list`,
        parameters: z.object({}),
        execute: async () => getList(),
      }),
      readFile: tool({
        description: "Read file from filesystem",
        parameters: z.object({}),
        execute: async () => {
          const __dirname = path.dirname(import.meta.dirname);

          const pdfReader = new PdfReader();
          const promise = new Promise<string>((resolve) => {
            const textArray: string[] = [];
            pdfReader.parseFileItems(
              path.join(__dirname, "./todo/files/analisi.pdf"),
              (err, item) => {
                if (err) console.error("error:", err);
                else if (!item) {
                  console.warn("end of file");
                  resolve(textArray.join(" "));
                } else if (item.text) {
                  console.log("END");
                  textArray.push(item.text);
                }
              }
            );
          });

          const text = await promise;

          return text;
        },
      }),
      writeFile: tool({
        description: "Write report to filesystem",
        parameters: z.object({
          description: z.string().describe("description of the report"),
        }),
        execute: async ({ description }) => {
          const __dirname = path.dirname(import.meta.dirname);
          fs.writeFileSync(
            path.join(__dirname, "./todo/files/report.txt"),
            description
          );
          return "I've saved the report";
        },
      }),
      // answer: tool({
      //   description: "A tool for providing the final answer.",
      //   parameters: z.object({
      //     items: z.array(
      //       z.object({
      //         description: z.string(),
      //         id: z.string(),
      //         done: z.boolean(),
      //       })
      //     ),
      //     answer: z.string(),
      //   }),
      // no execute function - invoking it will terminate the agent
      //}),
    },
    maxSteps: 20,
  });

  //messages.push({ role: "assistant", content: await result.text });

  return result;
}

const port = 4000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
