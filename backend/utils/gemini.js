import { GoogleGenerativeAI } from '@google/generative-ai';
import { cosineSimilarity } from './embeddings.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Find relevant chunks using semantic search
export async function findRelevantChunks(query, chunks, topK = 3) {
  // Create embedding for the query
  const queryWords = query.toLowerCase().split(/\s+/);
  const queryEmbedding = createQueryEmbedding(queryWords);
  
  // Calculate similarity scores
  const scoredChunks = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));
  
  // Sort by score and return top K
  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Create embedding for query (simplified version)
function createQueryEmbedding(words, dimensions = 128) {
  const embedding = new Array(dimensions).fill(0);
  
  words.forEach(word => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    
    const index = Math.abs(hash) % dimensions;
    embedding[index] += 1;
  });
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
}

// Generate response using Google Gemini
export async function generateResponse(userMessage, context, fileName) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `You are a helpful AI assistant that answers questions about PDF documents.

Document: ${fileName}

Relevant content from the document:
${context}

User question: ${userMessage}

Instructions:
- Answer the question based ONLY on the provided document content
- If the answer is not in the provided content, say so clearly
- Be concise but comprehensive
- Use direct quotes when helpful
- If asked about something not in the document, politely state that the information is not available in this document

Answer:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    return text;
  } catch (err) {
    console.error('Gemini API error:', err);
    throw new Error('Failed to generate response from AI');
  }
}