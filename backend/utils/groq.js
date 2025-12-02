import Groq from "groq-sdk";
import cosineSimilarity from "compute-cosine-similarity";

function getClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY missing");
  }

  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}


export async function generateResponse(prompt) {
  const client = getClient();

  const completion = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",

    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content;
}


/* =========================
   FIND RELEVANT CHUNKS (RAG)
========================= */
function fakeEmbedding(text) {
  // Temporary hashing-based vector for similarity (no embedding API)
  const vec = new Array(128).fill(0);

  for (let i = 0; i < text.length; i++) {
    vec[i % 128] += text.charCodeAt(i);
  }

  return vec;
}

export async function findRelevantChunks(query, chunks, topK = 3) {
  const queryVec = fakeEmbedding(query);

  const scored = chunks.map(chunk => {
    const score = cosineSimilarity(queryVec, fakeEmbedding(chunk.text));
    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
