import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import ollama, { type Message } from "ollama";
import Database from "../persistence/database.js";

const app = new Hono();
const db = new Database(
  {
    host: "localhost",
    user: "postgres",
    password: "postgres",
    database: "todo_ai",
    port: 5432,
  },
  { logError: (message: string, data: any) => console.log(message, data) }
);
app.use("*", cors());

interface NewToDoItem {
  description: string;
}

interface ExecuteCommand {
  query: string;
}

interface ToDo {
  id: string;
  description: string;
  done: boolean;
}

const messages: Message[] = [];

app.post("/", async (c) => {
  const body: NewToDoItem = await c.req.json();
  await run(body.description);
  const results = await db.query("SELECT content, done from todos_list");
  const todoList: ToDo[] = results.map((r) => ({
    description: r.content,
    id: r.id,
    done: r.done,
  }));
  return c.json(
    results.map((r) => ({
      description: r.content,
      done: r.done,
    }))
  );
});

async function executeQuery(command: ExecuteCommand) {
  console.log("QUERY", command.query);
  const result = await db.query(command.query);
  if (result.length === 1) {
    return JSON.stringify(result[0]);
  } else {
    return result ? JSON.stringify(result) : "";
  }
}

async function run(description: string) {
  const model = "llama3.1";
  // Initialize conversation with a user query
  messages.push(
    {
      role: "system",
      content: `As system administrato you should compose select queries on postgres database that contains todos.
      You should search for todos inserted by user or insert new todos matching the prompt provided by user. 
      The table in the database is named todos_list and its schema is describe by the following scrit: 
      CREATE TABLE "public"."todos_list" (
        "content" text NOT NULL,
        "done" bool NOT NULL
      );
      When you create the query statement pay attention to NOT NULL fields. You should provied value to that fields
      To execute queries allways use the tool named execute_query. Allways save text data in lowercase`,
    },
    {
      role: "user",
      content: description,
    }
  );

  const response = await ollama.chat({
    model: model,
    messages: messages,
    tools: [
      {
        type: "function",
        function: {
          name: "execute_query",
          description: "Execute the query to insert items to the list",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "query string to execute",
              },
            },
            required: ["query"],
          },
        },
      },
    ],
  });
  // Add the model's response to the conversation history
  messages.push(response.message);

  // Check if the model decided to use the provided function
  if (
    !response.message.tool_calls ||
    response.message.tool_calls.length === 0
  ) {
    console.log("The model didn't use the function. Its response was:");
    console.log(response.message.content);
    return;
  }

  // Process function calls made by the model
  if (response.message.tool_calls) {
    const availableFunctions = {
      execute_query: executeQuery,
    };
    for (const tool of response.message.tool_calls) {
      console.log(tool.function.name);
      const functionToCall = availableFunctions[tool.function.name];
      const functionResponse = availableFunctions
        ? await functionToCall(tool.function.arguments)
        : "no function found";
      // Add function response to the conversation
      messages.push({
        role: "tool",
        content: functionResponse,
      });
    }
  }

  //console.log("MESSAGES --> ", JSON.stringify(messages, null, 2));

  // Second API call: Get final response from the model
  console.log("messages ----->>>", messages);

  const finalResponse = await ollama.chat({
    model: model,
    messages: messages,
  });

  messages.push(finalResponse.message);
  console.log(finalResponse.message.content);
}

const port = 4000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
