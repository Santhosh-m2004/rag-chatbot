// Text chunking utility
export function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let startIndex = 0;
  
  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);
    
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }
    
    startIndex += chunkSize - overlap;
  }
  
  return chunks;
}

// Simple embedding generation (in production, use proper embedding model)
export async function generateEmbeddings(chunks) {
  // This is a simplified version. In production, use:
  // - Google's text-embedding-004 model
  // - OpenAI embeddings
  // - Sentence transformers
  // For now, we'll create simple embeddings based on word frequency
  
  const chunksWithEmbeddings = chunks.map(text => {
    const embedding = createSimpleEmbedding(text);
    return { text, embedding };
  });
  
  return chunksWithEmbeddings;
}

// Create a simple embedding (for demonstration purposes)
function createSimpleEmbedding(text, dimensions = 128) {
  const words = text.toLowerCase().split(/\s+/);
  const embedding = new Array(dimensions).fill(0);
  
  // Create a deterministic hash for each word
  words.forEach(word => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    
    const index = Math.abs(hash) % dimensions;
    embedding[index] += 1;
  });
  
  // Normalize the embedding
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
}

// Calculate cosine similarity
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  
  if (magA === 0 || magB === 0) return 0;
  
  return dotProduct / (magA * magB);
}