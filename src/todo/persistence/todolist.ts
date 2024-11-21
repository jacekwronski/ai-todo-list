import type { NewToDoItem, ToDo } from "../entities/todolist.js";
import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { v4 as uuid } from "uuid";
import Database from "../../persistence/database.js";
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

const openai = createOpenAI({
  apiKey: "",
  compatibility: "strict",
});

const embeddingModel = openai.embedding("text-embedding-3-large", {
  dimensions: 1024,
});

const generateChunks = (input: string): string[] => {
  return input
    .trim()
    .split(".")
    .filter((i) => i !== "");
};

export const generateEmbeddings = async (value: string): Promise<number[]> => {
  const chunks = generateChunks(value);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });
  return embeddings[0];
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll("\\n", " ");
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return embedding;
};

export async function addItem(item: NewToDoItem) {
  const embeddings = await generateEmbeddings(item.description);

  await db.query(
    "INSERT INTO todos (id, content, done, embedding) VALUES($1, $2, $3, $4)",
    [uuid(), item.description, false, JSON.stringify(embeddings)]
  );

  return `${item.description} has been added to the list`;
}

export async function markAdDone(item: NewToDoItem) {
  const embedded = await generateEmbedding(item.description);

  const queryResult = await db.query(
    "SELECT id FROM todos ORDER BY embedding <=> $1 LIMIT 1;",
    [JSON.stringify(embedded)]
  );

  if (queryResult.length > 0) {
    await db.query("UPDATE todos SET done = true WHERE id=$1", [
      queryResult[0].id,
    ]);
    return "Done, can I do anything else for you?";
  }

  return "Sorry I can't find the item you looking for.";
}

export async function removeItem(item: NewToDoItem) {
  const embedded = await generateEmbedding(item.description);

  const queryResult = await db.query(
    "SELECT id FROM todos ORDER BY embedding <=> $1 LIMIT 1;",
    [JSON.stringify(embedded)]
  );

  if (queryResult.length > 0) {
    await db.query("DELETE FROM todos WHERE id = $1", [queryResult[0].id]);
    return "Done, can I do anything else for you?";
  }

  return "Sorry I can't find the item you looking for.";
}

export async function getList() {
  const results = await db.query("SELECT id, content, done from todos");
  const todoList: ToDo[] = results.map((r) => ({
    description: r.content,
    id: r.id,
    done: r.done,
  }));
  return JSON.stringify(todoList);
}

export async function getAllList() {
  const results = await db.query("SELECT id, content, done from todos");
  const todoList: ToDo[] = results.map((r) => ({
    description: r.content,
    id: r.id,
    done: r.done,
  }));
  return todoList;
}
