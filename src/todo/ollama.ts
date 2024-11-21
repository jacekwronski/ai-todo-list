import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuid } from "uuid";
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

interface ToDo {
  id: string;
  description: string;
  done: boolean;
}

const messages: Message[] = [];

app.post("/", async (c) => {
  const body: NewToDoItem = await c.req.json();
  await run(body.description);
  const results = await db.query("SELECT id, content, done from todos");
  const todoList: ToDo[] = results.map((r) => ({
    description: r.content,
    id: r.id,
    done: r.done,
  }));
  return c.json(todoList);
});

async function addItem(item: NewToDoItem) {
  const result = await ollama.embeddings({
    model: "mxbai-embed-large",
    prompt: item.description,
  });

  await db.query(
    "INSERT INTO todos (id, content, done, embedding) VALUES($1, $2, $3, $4)",
    [uuid(), item.description, false, JSON.stringify(result.embedding)]
  );

  return `${item.description} has been added to the list`;
}

async function markAdDone(item: NewToDoItem) {
  const result = await ollama.embeddings({
    model: "mxbai-embed-large",
    prompt: item.description,
  });

  const queryResult = await db.query(
    "SELECT id FROM todos ORDER BY embedding <=> $1 LIMIT 1;",
    [JSON.stringify(result.embedding)]
  );

  if (queryResult.length > 0) {
    await db.query("UPDATE todos SET done = true WHERE id=$1", [
      queryResult[0].id,
    ]);
    return "Done, can I do anything else for you?";
  }

  return "Sorry I can't find the item you looking for.";
}

async function removeItem(item: NewToDoItem) {
  const result = await ollama.embeddings({
    model: "mxbai-embed-large",
    prompt: item.description,
  });

  const queryResult = await db.query(
    "SELECT id FROM todos ORDER BY embedding <=> $1 LIMIT 1;",
    [JSON.stringify(result.embedding)]
  );

  console.log("REMOVE ITEM", queryResult);

  if (queryResult.length > 0) {
    await db.query("DELETE FROM todos WHERE id = $1", [queryResult[0].id]);
    return "Done, can I do anything else for you?";
  }

  return "Sorry I can't find the item you looking for.";
}

async function getList() {
  const results = await db.query("SELECT id, content, done from todos");
  const todoList: ToDo[] = results.map((r) => ({
    description: r.content,
    id: r.id,
    done: r.done,
  }));
  return JSON.stringify(todoList);
}

async function run(description: string) {
  const model = "llama3.1";
  // Initialize conversation with a user query
  messages.push(
    {
      role: "system",
      content: `As system administrato you should compose select queries on postgres database that contains todos.
      You should search for todos inserted by user or insert new todos matching the prompt provided by user. 
      The table in the database is named todos and its columns are id, content, done, embedding where id is an uuid, content is a string, done is a boolean and embedding is a vector`,
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
          name: "add_item",
          description: "Add item to todo list",
          parameters: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description: "The description of todo list item",
              },
            },
            required: ["description"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "mark_as_done",
          description: "Mark the todo item as done",
          parameters: {
            type: "string",
            properties: {
              description: {
                type: "string",
                description: "The description of todo list item",
              },
            },
            required: ["description"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "remove_item",
          description: "Remove item from the list",
          parameters: {
            type: "string",
            properties: {
              description: {
                type: "string",
                description: "The description of item to remove",
              },
            },
            required: ["description"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_list",
          description: "Get items list",
          parameters: {
            type: "string",
            properties: {
              description: {
                type: "string",
                description: "The description of item to remove",
              },
            },
            required: [],
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
      add_item: addItem,
      mark_as_done: markAdDone,
      remove_item: removeItem,
      get_list: getList,
    };
    for (const tool of response.message.tool_calls) {
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
