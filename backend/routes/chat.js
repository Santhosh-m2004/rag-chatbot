import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import { generateResponse } from '../utils/groq.js';
import { createSimpleEmbedding, cosineSimilarity } from '../utils/embeddings.js';

const router = express.Router();

// Chat with PDF (RAG implementation)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { message, pdfId } = req.body;
    const userId = req.userId;

    console.log('\n=== RAG CHAT REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID:', userId);

    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required' 
      });
    }

    if (!pdfId) {
      console.log('⚠️ No PDF ID provided - using direct AI response');
      const directResponse = await generateResponse(message);
      return res.json({
        response: directResponse,
        source: 'direct_ai_no_pdf',
        relevantChunks: []
      });
    }

    // Find the specific PDF for this user
    const pdf = await PDF.findOne({ 
      _id: pdfId, 
      userId: userId 
    }).lean(); // Use lean() for better performance

    if (!pdf) {
      console.log('❌ PDF not found for user');
      const directResponse = await generateResponse(message);
      return res.json({
        response: directResponse,
        source: 'direct_ai_pdf_not_found',
        relevantChunks: []
      });
    }

    console.log(`✅ PDF found: ${pdf.filename}`);
    console.log(`PDF ID: ${pdf._id}`);
    console.log(`Text length: ${pdf.textContent?.length || 0} chars`);
    console.log(`Chunks count: ${pdf.chunks?.length || 0}`);

    // Check if PDF has chunks
    if (!pdf.chunks || pdf.chunks.length === 0) {
      console.log('❌ PDF has no chunks - using direct AI');
      const directResponse = await generateResponse(message);
      return res.json({
        response: directResponse,
        source: 'direct_ai_no_chunks',
        relevantChunks: []
      });
    }

    // Create query embedding
    const queryEmbedding = createSimpleEmbedding(message);
    console.log(`Query embedding created: ${queryEmbedding.length} dimensions`);

    // Calculate similarity with ALL chunks
    console.log('Calculating similarities with all chunks...');
    const chunksWithScores = [];
    
    for (let i = 0; i < pdf.chunks.length; i++) {
      const chunk = pdf.chunks[i];
      if (!chunk.embedding || chunk.embedding.length === 0) {
        console.log(`Chunk ${i} has no embedding`);
        continue;
      }
      
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      chunksWithScores.push({
        index: i,
        text: chunk.text,
        score: similarity,
        embeddingLength: chunk.embedding.length
      });
    }

    console.log(`Processed ${chunksWithScores.length} chunks with embeddings`);

    // Sort by relevance
    chunksWithScores.sort((a, b) => b.score - a.score);

    // Log top similarities
    console.log('\nTop 5 similarities:');
    chunksWithScores.slice(0, 5).forEach((chunk, i) => {
      console.log(`${i + 1}. Score: ${chunk.score.toFixed(4)} - ${chunk.text.substring(0, 100)}...`);
    });

    // Get relevant chunks - use VERY LOW threshold to ensure we get something
    const relevantChunks = chunksWithScores
      .filter(chunk => chunk.score > 0.01) // Extremely low threshold
      .slice(0, 5);

    console.log(`Found ${relevantChunks.length} relevant chunks (score > 0.01)`);

    // If no relevant chunks found, force use top 3 chunks anyway
    let finalChunks = relevantChunks;
    if (finalChunks.length === 0 && chunksWithScores.length > 0) {
      console.log('⚠️ No chunks above threshold, using top 3 chunks anyway');
      finalChunks = chunksWithScores.slice(0, 3);
    }

    if (finalChunks.length === 0) {
      console.log('❌ No chunks available at all - using direct AI');
      const directResponse = await generateResponse(message);
      return res.json({
        response: directResponse,
        source: 'direct_ai_no_relevant_chunks',
        relevantChunks: []
      });
    }

    // Create context from relevant chunks
    const context = finalChunks.map(chunk => chunk.text).join('\n\n');
    console.log(`Context created: ${context.length} characters`);

    // Create STRICT RAG prompt
    // In chat.js, replace the prompt creation logic with this:

// Analyze question type and create targeted prompt
let ragPrompt;
const question = message.toLowerCase().trim();

console.log(`Analyzing question: "${message}"`);

// Common question patterns
const isGreeting = /^(hi|hello|hey|greetings)/.test(question);
const isSummaryRequest = /\b(summar|overview|about|tell me about|what is this|describe)\b/.test(question);
const isSpecificQuestion = /\b(tech stack|technology|framework|library|tool|language|skill|how.*built|what.*use(d)?)\b/.test(question);
const isListQuestion = /\b(list|name|what are|which|mention)\b/.test(question);
const isPersonQuestion = /\b(who|person|student|author|supervisor|professor)\b/.test(question);
const isDetailQuestion = /\b(detail|explain|elaborate|how.*work|process|methodology)\b/.test(question);

if (isGreeting) {
  ragPrompt = `You are analyzing this document. Provide a helpful greeting and brief introduction:
  
  DOCUMENT CONTENT:
  ${context}
  
  Respond with a friendly greeting and a 1-2 sentence overview of what this document is about.`;
  
  console.log('Detected: Greeting question');
  
} else if (isSummaryRequest) {
  ragPrompt = `Provide a concise summary of this document:
  
  DOCUMENT CONTENT:
  ${context}
  
  Create a structured summary with:
  1. Document type and purpose
  2. Main topics/themes
  3. Key findings or conclusions
  4. Any notable details
  
  Keep it informative but not too verbose.`;
  
  console.log('Detected: Summary request');
  
} else if (isSpecificQuestion) {
  // Extract specific information from context
  const techKeywords = ['tech stack', 'technology', 'framework', 'library', 'tool', 
                       'language', 'software', 'platform', 'system', 'architecture'];
  
  ragPrompt = `Extract SPECIFIC technical information from this document:
  
  DOCUMENT CONTENT:
  ${context}
  
  QUESTION: ${message}
  
  Focus on extracting concrete technical details mentioned in the document such as:
  - Programming languages (Java, Python, JavaScript, etc.)
  - Frameworks and libraries (React, Node.js, Express, etc.)
  - Databases (MongoDB, MySQL, etc.)
  - Tools and platforms (Git, Docker, Blockchain, IPFS, etc.)
  - Technologies mentioned specifically
  
  If the document mentions specific technologies, list them clearly.
  If not explicitly mentioned, say what technical information IS available.`;
  
  console.log('Detected: Technical/specific question');
  
} else if (isListQuestion) {
  ragPrompt = `List specific items or information from the document:
  
  DOCUMENT CONTENT:
  ${context}
  
  QUESTION: ${message}
  
  Extract and list specific items mentioned in the document.
  Format as bullet points if appropriate.`;
  
  console.log('Detected: List question');
  
} else if (isPersonQuestion) {
  ragPrompt = `Extract information about people mentioned:
  
  DOCUMENT CONTENT:
  ${context}
  
  QUESTION: ${message}
  
  Find and list:
  - Authors/creators
  - Team members
  - Supervisors/mentors
  - Any other individuals mentioned
  
  Include their roles or affiliations if mentioned.`;
  
  console.log('Detected: Person-related question');
  
} else if (isDetailQuestion) {
  ragPrompt = `Provide detailed explanation based on document:
  
  DOCUMENT CONTENT:
  ${context}
  
  QUESTION: ${message}
  
  Give a detailed, explanatory response based strictly on the document content.
  Include specific examples or processes mentioned in the document.`;
  
  console.log('Detected: Detailed explanation request');
  
} else {
  // General question - be more directive
  ragPrompt = `Answer this question by extracting SPECIFIC information from the document:
  
  DOCUMENT CONTENT:
  ${context}
  
  QUESTION: ${message}
  
  Your response must:
  1. Be based ONLY on information found in the document above
  2. Extract and present specific facts, names, numbers, or details mentioned
  3. If exact answer isn't found, present the closest relevant information
  4. Quote or reference specific parts when possible
  5. Avoid generalizations - be specific and concrete
  
  Focus on WHAT IS ACTUALLY IN THE DOCUMENT, not general knowledge.`;
  
  console.log('Detected: General question');
}

    console.log('\nSending to Groq with RAG context...');
    console.log(`Prompt length: ${ragPrompt.length} chars`);
    
    // Generate response using Groq
    const response = await generateResponse(ragPrompt);

    console.log('✅ Response generated successfully');
    console.log(`Response: ${response.substring(0, 200)}...`);

    res.json({
      response,
      source: 'pdf_content',
      relevantChunks: finalChunks.map((chunk, index) => ({
        id: index,
        text: chunk.text.substring(0, 150) + '...',
        score: chunk.score
      })),
      debug: {
        pdfId: pdf._id,
        pdfName: pdf.filename,
        totalChunks: pdf.chunks.length,
        chunksWithEmbeddings: chunksWithScores.length,
        relevantChunksUsed: finalChunks.length,
        topScore: finalChunks[0]?.score || 0,
        contextLength: context.length
      }
    });

    console.log('=== RAG COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Chat error:', error);
    console.error('Error stack:', error.stack);
    
    // Try direct response as last resort
    try {
      console.log('Attempting direct response as fallback...');
      const directResponse = await generateResponse(req.body.message);
      return res.json({
        response: directResponse,
        source: 'direct_fallback_after_error',
        relevantChunks: [],
        error: error.message
      });
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      res.status(500).json({ 
        error: 'Failed to process request',
        details: error.message
      });
    }
  }
});

// Get chat history for a PDF
router.get('/history/:pdfId', authMiddleware, async (req, res) => {
  try {
    const pdf = await PDF.findOne({
      _id: req.params.pdfId,
      userId: req.userId
    }).select('_id filename');

    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    res.json({
      pdfId: pdf._id,
      pdfName: pdf.filename,
      messages: []
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Debug endpoint: Get PDF details
router.get('/debug/pdf/:pdfId', authMiddleware, async (req, res) => {
  try {
    const pdf = await PDF.findOne({
      _id: req.params.pdfId,
      userId: req.userId
    });

    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    res.json({
      pdf: {
        _id: pdf._id,
        filename: pdf.filename,
        textLength: pdf.textContent?.length || 0,
        chunkCount: pdf.chunks?.length || 0,
        firstChunk: pdf.chunks?.[0] || null,
        sampleText: pdf.textContent?.substring(0, 500) || ''
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;