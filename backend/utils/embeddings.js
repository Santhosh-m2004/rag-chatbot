// Text chunking utility
export function chunkText(text, chunkSize = 1000, overlap = 200) {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  const chunks = [];
  let startIndex = 0;
  
  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex).trim();
    
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    
    startIndex += chunkSize - overlap;
    
    // Safety break
    if (chunks.length > 100) break;
  }
  
  return chunks;
}

// Generate embeddings for text chunks
export async function generateEmbeddings(chunks) {
  console.log(`Generating embeddings for ${chunks.length} chunks...`);
  
  const chunksWithEmbeddings = chunks.map((text, index) => {
    try {
      const embedding = createSimpleEmbedding(text);
      
      // Validate embedding
      if (!embedding || embedding.length === 0) {
        console.error(`Embedding generation failed for chunk ${index}`);
        return { text, embedding: new Array(128).fill(0) };
      }
      
      return { text, embedding };
    } catch (error) {
      console.error(`Error generating embedding for chunk ${index}:`, error);
      return { text, embedding: new Array(128).fill(0) };
    }
  });
  
  console.log(`Generated ${chunksWithEmbeddings.length} embeddings`);
  
  // Verify at least one embedding is valid
  const validEmbeddings = chunksWithEmbeddings.filter(c => 
    c.embedding && c.embedding.length > 0 && c.embedding.some(v => v !== 0)
  );
  
  console.log(`Valid embeddings: ${validEmbeddings.length}/${chunksWithEmbeddings.length}`);
  
  return chunksWithEmbeddings;
}

// Create a simple embedding
export function createSimpleEmbedding(text, dimensions = 128) {
  if (!text || typeof text !== 'string') {
    console.error('Invalid text for embedding:', text);
    return new Array(dimensions).fill(0);
  }
  
  const cleanText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleanText.length === 0) {
    return new Array(dimensions).fill(0);
  }
  
  const words = cleanText.split(' ');
  const embedding = new Array(dimensions).fill(0);
  
  // Simple but consistent hashing
  words.forEach((word, wordIndex) => {
    if (word.length < 2) return;
    
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Use word position to influence the hash
    const positionFactor = (wordIndex % 3) + 1;
    const finalHash = Math.abs(hash * positionFactor);
    
    // Distribute across multiple indices
    for (let j = 0; j < 3; j++) {
      const index = (finalHash + j * 31) % dimensions;
      embedding[index] += 1 / (j + 1);
    }
  });
  
  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude);
  }
  
  return embedding;
}

// Calculate cosine similarity
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB)) {
    console.error('Invalid vectors for cosine similarity:', { vecA, vecB });
    return 0;
  }
  
  if (vecA.length !== vecB.length) {
    console.error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
    return 0;
  }
  
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i] || 0;
    const b = vecB[i] || 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  }
  
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  
  if (magA === 0 || magB === 0) {
    return 0;
  }
  
  const similarity = dotProduct / (magA * magB);
  return Math.max(-1, Math.min(1, similarity)); // Clamp to [-1, 1]
}