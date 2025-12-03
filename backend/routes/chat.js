import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import ChatHistory from '../models/ChatHistory.js';
import { generateResponse } from '../utils/groq.js';
import { createSimpleEmbedding, cosineSimilarity } from '../utils/embeddings.js';

const router = express.Router();

// Helper function to detect if it's just a simple greeting
function isSimpleGreeting(message) {
  const simpleGreetings = [
    'hi', 'hello', 'hey', 'greetings', 
    'good morning', 'good afternoon', 'good evening',
    'hi there', 'hello there'
  ];
  
  const cleanedMessage = message.toLowerCase().trim();
  
  // Check exact matches
  if (simpleGreetings.includes(cleanedMessage)) {
    return true;
  }
  
  // Check with punctuation
  const greetingsWithPunctuation = simpleGreetings.map(g => `${g}.`).concat(simpleGreetings.map(g => `${g}!`));
  if (greetingsWithPunctuation.includes(cleanedMessage)) {
    return true;
  }
  
  // Check if it's just "hi" or "hello" with minor variations
  const words = cleanedMessage.split(/\s+/);
  if (words.length === 1 && (words[0].startsWith('hi') || words[0].startsWith('hello') || words[0].startsWith('hey'))) {
    return true;
  }
  
  return false;
}

// Helper function to detect if it's asking about the PDF
function isAskingAboutPDF(message) {
  const pdfKeywords = [
    'pdf', 'document', 'file', 'about', 'tell me', 'describe', 
    'summarize', 'what is', 'overview', 'what\'s this', 'whats this',
    'explain this', 'explain the'
  ];
  
  const cleanedMessage = message.toLowerCase().trim();
  
  return pdfKeywords.some(keyword => cleanedMessage.includes(keyword));
}

// Chat with PDF (RAG implementation with history)
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

    // Find or create chat history
    let chatHistory = await ChatHistory.findOne({
      userId: userId,
      pdfId: pdfId
    });

    if (!chatHistory) {
      // Get PDF info for title
      const pdf = await PDF.findOne({ _id: pdfId, userId: userId }).select('filename');
      const title = pdf ? `Chat about ${pdf.filename}` : 'Chat Session';
      
      chatHistory = new ChatHistory({
        userId: userId,
        pdfId: pdfId,
        title: title,
        messages: []
      });
      await chatHistory.save();
      console.log('✅ Created new chat history');
    }

    console.log(`📝 Chat History ID: ${chatHistory._id}`);
    console.log(`Previous messages: ${chatHistory.messages.length}`);

    // Find the PDF
    const pdf = await PDF.findOne({ 
      _id: pdfId, 
      userId: userId 
    }).lean();

    if (!pdf) {
      console.log('❌ PDF not found for user');
      const directResponse = await generateResponse(message);
      
      // Save user message anyway
      chatHistory.messages.push({
        role: 'user',
        content: message
      });
      chatHistory.messages.push({
        role: 'assistant',
        content: directResponse,
        source: 'direct_ai_pdf_not_found'
      });
      await chatHistory.save();
      
      return res.json({
        response: directResponse,
        source: 'direct_ai_pdf_not_found',
        relevantChunks: [],
        chatHistoryId: chatHistory._id
      });
    }

    console.log(`✅ PDF found: ${pdf.filename}`);
    console.log(`PDF ID: ${pdf._id}`);

    // Save user message to history
    chatHistory.messages.push({
      role: 'user',
      content: message
    });

    // Check if it's just a simple greeting
    if (isSimpleGreeting(message)) {
      console.log('✅ Detected simple greeting - responding casually');
      
      // Get last 2 messages for context
      const lastMessages = chatHistory.messages.slice(-3, -1); // Exclude current message
      const hasPreviousConversation = lastMessages.length > 0;
      
      let greetingPrompt;
      
      if (hasPreviousConversation) {
        // Continue existing conversation
        greetingPrompt = `Continue the conversation naturally. 
        
        Previous messages:
        ${lastMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}
        
        User just said: "${message}"
        
        Respond with a simple, friendly greeting to continue the conversation naturally. 
        Keep it casual and short (1-2 sentences max).`;
      } else {
        // Start new conversation
        greetingPrompt = `Start a new conversation about a PDF document.
        
        PDF filename: "${pdf.filename}"
        User said: "${message}"
        
        Respond with a simple, friendly greeting. Examples:
        - "Hi! 👋"
        - "Hello! How can I help you today?"
        - "Hey there!"
        - "Hi! Ready when you are."
        
        DO NOT mention or describe the PDF content. Just greet naturally.`;
      }
      
      const response = await generateResponse(greetingPrompt);
      
      // Save assistant response
      chatHistory.messages.push({
        role: 'assistant',
        content: response,
        source: 'greeting'
      });
      await chatHistory.save();
      
      console.log(`💾 Saved greeting response. Total messages: ${chatHistory.messages.length}`);
      
      return res.json({
        response,
        source: 'greeting',
        relevantChunks: [],
        chatHistoryId: chatHistory._id
      });
    }

    // Check if PDF has chunks
    if (!pdf.chunks || pdf.chunks.length === 0) {
      console.log('❌ PDF has no chunks - using direct AI');
      const directResponse = await generateResponse(message);
      
      chatHistory.messages.push({
        role: 'assistant',
        content: directResponse,
        source: 'direct_ai_no_chunks'
      });
      await chatHistory.save();
      
      return res.json({
        response: directResponse,
        source: 'direct_ai_no_chunks',
        relevantChunks: [],
        chatHistoryId: chatHistory._id
      });
    }

    console.log(`Text length: ${pdf.textContent?.length || 0} chars`);
    console.log(`Chunks count: ${pdf.chunks?.length || 0}`);

    // Create query embedding
    const queryEmbedding = createSimpleEmbedding(message);
    console.log(`Query embedding created: ${queryEmbedding.length} dimensions`);

    // Calculate similarity with ALL chunks
    console.log('Calculating similarities with all chunks...');
    const chunksWithScores = [];
    
    for (let i = 0; i < pdf.chunks.length; i++) {
      const chunk = pdf.chunks[i];
      if (!chunk.embedding || chunk.embedding.length === 0) {
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

    // Log top 3 similarities for debugging
    if (chunksWithScores.length > 0) {
      console.log('Top 3 similarities:');
      chunksWithScores.slice(0, 3).forEach((chunk, i) => {
        console.log(`${i + 1}. Score: ${chunk.score.toFixed(4)} - ${chunk.text.substring(0, 100)}...`);
      });
    }

    // Get relevant chunks
    const relevantChunks = chunksWithScores
      .filter(chunk => chunk.score > 0.01)
      .slice(0, 5);

    console.log(`Found ${relevantChunks.length} relevant chunks (score > 0.01)`);

    // If no relevant chunks found, use top 3 chunks anyway
    let finalChunks = relevantChunks;
    if (finalChunks.length === 0 && chunksWithScores.length > 0) {
      console.log('⚠️ No chunks above threshold, using top 3 chunks anyway');
      finalChunks = chunksWithScores.slice(0, 3);
    }

    if (finalChunks.length === 0) {
      console.log('❌ No chunks available at all - using direct AI');
      const directResponse = await generateResponse(message);
      
      chatHistory.messages.push({
        role: 'assistant',
        content: directResponse,
        source: 'direct_ai_no_relevant_chunks'
      });
      await chatHistory.save();
      
      return res.json({
        response: directResponse,
        source: 'direct_ai_no_relevant_chunks',
        relevantChunks: [],
        chatHistoryId: chatHistory._id
      });
    }

    // Create context from relevant chunks
    const context = finalChunks.map(chunk => chunk.text).join('\n\n');
    console.log(`Context created: ${context.length} characters`);

    // Get conversation context (last 4 messages for continuity)
    const lastMessages = chatHistory.messages.slice(-4);
    const conversationContext = lastMessages.length > 0 
      ? lastMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')
      : 'No previous conversation';

    // Create smart RAG prompt
    let ragPrompt;
    
    if (isAskingAboutPDF(message)) {
      // User is asking about the PDF specifically
      ragPrompt = `You are helping a user understand a PDF document.
      
      PDF FILENAME: "${pdf.filename}"
      
      DOCUMENT CONTENT (relevant parts):
      ${context}
      
      USER'S QUESTION: "${message}"
      
      Please provide a helpful response about the document. If you can't find specific information, 
      say what you can based on the available content.`;
      
      console.log('Detected: PDF-specific question');
    } else {
      // General question that should use PDF content
      ragPrompt = `You are having a conversation about a PDF document with a user.
      
      PREVIOUS CONVERSATION (for context):
      ${conversationContext}
      
      PDF FILENAME: "${pdf.filename}"
      
      RELEVANT DOCUMENT CONTEXT:
      ${context}
      
      USER'S CURRENT QUESTION: "${message}"
      
      Please answer based on the document content above. Continue the conversation naturally.`;
      
      console.log('Detected: General question using PDF content');
    }

    console.log('\nSending to Groq with context...');
    console.log(`Prompt length: ${ragPrompt.length} chars`);
    
    // Generate response using Groq
    const response = await generateResponse(ragPrompt);

    console.log('✅ Response generated successfully');
    console.log(`Response preview: ${response.substring(0, 200)}...`);

    // Save assistant response to history
    chatHistory.messages.push({
      role: 'assistant',
      content: response,
      source: 'pdf_content',
      metadata: {
        relevantChunks: finalChunks.length,
        topScore: finalChunks[0]?.score || 0
      }
    });
    
    await chatHistory.save();
    console.log(`💾 Saved to chat history. Total messages: ${chatHistory.messages.length}`);

    res.json({
      response,
      source: 'pdf_content',
      relevantChunks: finalChunks.map((chunk, index) => ({
        id: index,
        text: chunk.text.substring(0, 150) + '...',
        score: chunk.score
      })),
      chatHistoryId: chatHistory._id,
      debug: {
        pdfId: pdf._id,
        pdfName: pdf.filename,
        totalChunks: pdf.chunks.length,
        relevantChunksUsed: finalChunks.length,
        topScore: finalChunks[0]?.score || 0,
        conversationMessages: chatHistory.messages.length
      }
    });

    console.log('=== RAG COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Chat error:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message
    });
  }
});

// Get chat history for a PDF
router.get('/history/:pdfId', authMiddleware, async (req, res) => {
  try {
    const chatHistory = await ChatHistory.findOne({
      pdfId: req.params.pdfId,
      userId: req.userId
    }).sort({ lastActive: -1 });

    if (!chatHistory) {
      return res.json({
        pdfId: req.params.pdfId,
        messages: [],
        title: 'New Chat'
      });
    }

    res.json({
      chatHistoryId: chatHistory._id,
      pdfId: chatHistory.pdfId,
      title: chatHistory.title,
      messages: chatHistory.messages,
      lastActive: chatHistory.lastActive,
      createdAt: chatHistory.createdAt
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get all chat histories for user
router.get('/histories', authMiddleware, async (req, res) => {
  try {
    const chatHistories = await ChatHistory.find({
      userId: req.userId
    })
    .populate('pdfId', 'filename originalName')
    .sort({ lastActive: -1 })
    .select('_id pdfId title lastActive createdAt messages');

    res.json({
      chatHistories: chatHistories.map(chat => ({
        _id: chat._id,
        pdfId: chat.pdfId?._id,
        pdfName: chat.pdfId?.filename,
        title: chat.title,
        lastActive: chat.lastActive,
        createdAt: chat.createdAt,
        messageCount: chat.messages.length,
        lastMessage: chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].content.substring(0, 100) + '...' : ''
      }))
    });
  } catch (error) {
    console.error('Histories error:', error);
    res.status(500).json({ error: 'Failed to fetch chat histories' });
  }
});

// Delete a chat history
router.delete('/history/:chatId', authMiddleware, async (req, res) => {
  try {
    const result = await ChatHistory.deleteOne({
      _id: req.params.chatId,
      userId: req.userId
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Chat history not found' });
    }

    res.json({ message: 'Chat history deleted successfully' });
  } catch (error) {
    console.error('Delete history error:', error);
    res.status(500).json({ error: 'Failed to delete chat history' });
  }
});

// Clear all chat histories for a PDF
router.delete('/history/pdf/:pdfId', authMiddleware, async (req, res) => {
  try {
    const result = await ChatHistory.deleteMany({
      pdfId: req.params.pdfId,
      userId: req.userId
    });

    res.json({ 
      message: 'All chat histories for PDF deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Clear PDF history error:', error);
    res.status(500).json({ error: 'Failed to clear chat histories' });
  }
});

export default router;