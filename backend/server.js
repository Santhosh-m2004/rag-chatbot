import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import pdfRoutes from './routes/pdf.js';
import chatRoutes from './routes/chat.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ FIXED: Proper CORS Configuration for Render
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://rag-chatbot-1-0waf.onrender.com',  // Your frontend URL
      'https://rag-chatbot-lsru.onrender.com',    // Your backend URL (for direct access)
      // Add any other domains you need
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // For development, allow all origins
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Authorization'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Other middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rag-chatbot';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    console.log('Attempting to reconnect in 5 seconds...');
    setTimeout(() => {
      mongoose.connect(MONGODB_URI).catch(console.error);
    }, 5000);
  });

// Debug: Log all environment variables (mask secrets)
console.log('\n=== Environment Variables Check ===');
console.log('Current directory:', __dirname);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('PORT:', process.env.PORT || 5000);
console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✓ Set' : '✗ Missing');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? `✓ Set (${process.env.GROQ_API_KEY.substring(0, 4)}...)` : '✗ Missing');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? `✓ Set (${process.env.CLOUDINARY_CLOUD_NAME})` : '✗ Missing');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? `✓ Set (${process.env.CLOUDINARY_API_KEY.substring(0, 4)}...)` : '✗ Missing');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✓ Set (****)' : '✗ Missing');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✓ Set (****)' : '✗ Missing');
console.log('====================================\n');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pdfs', pdfRoutes);
app.use('/api/chat', chatRoutes);

// ✅ ADDED: Network test endpoint for mobile debugging
app.get('/api/network-test', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is reachable',
    timestamp: new Date().toISOString(),
    clientIP: req.ip,
    userAgent: req.headers['user-agent'],
    headers: {
      origin: req.headers.origin,
      host: req.headers.host,
      'user-agent': req.headers['user-agent']
    },
    deployment: {
      frontend: 'https://rag-chatbot-1-0waf.onrender.com',
      backend: 'https://rag-chatbot-lsru.onrender.com',
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

// ✅ ADDED: Mobile-specific health check
app.get('/api/mobile-health', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  res.json({
    status: 'healthy',
    service: 'RAG PDF Chatbot API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    urls: {
      frontend: 'https://rag-chatbot-1-0waf.onrender.com',
      backend: 'https://rag-chatbot-lsru.onrender.com',
      api: 'https://rag-chatbot-lsru.onrender.com/api'
    },
    endpoints: {
      auth: '/api/auth',
      pdfs: '/api/pdfs',
      chat: '/api/chat',
      health: '/api/health',
      networkTest: '/api/network-test',
      mobileHealth: '/api/mobile-health'
    },
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    services: {
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'missing',
      groq: process.env.GROQ_API_KEY ? 'configured' : 'missing'
    }
  });
});

// Enhanced health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'RAG Chatbot API is running',
    deployment: {
      frontend: 'https://rag-chatbot-1-0waf.onrender.com',
      backend: 'https://rag-chatbot-lsru.onrender.com',
      environment: process.env.NODE_ENV || 'development'
    },
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'missing',
      groq: process.env.GROQ_API_KEY ? 'configured' : 'missing'
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ✅ ADDED: Root endpoint with redirect
app.get('/', (req, res) => {
  res.json({
    message: 'RAG PDF Chatbot Backend API',
    version: '1.0.0',
    documentation: 'This is the backend API for the RAG PDF Chatbot',
    endpoints: {
      api: '/api',
      health: '/api/health',
      frontend: 'https://rag-chatbot-1-0waf.onrender.com'
    },
    status: 'operational'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  // Handle CORS errors specifically
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS Error',
      message: 'Request blocked by CORS policy',
      origin: req.headers.origin,
      allowedOrigins: [
        'https://rag-chatbot-1-0waf.onrender.com',
        'https://rag-chatbot-lsru.onrender.com'
      ],
      solution: 'Ensure your frontend URL is in the allowed origins list'
    });
  }
  
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong!' : err.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`,
    availableEndpoints: {
      api: '/api',
      health: '/api/health',
      networkTest: '/api/network-test',
      mobileHealth: '/api/mobile-health'
    }
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`🔗 Backend URL: https://rag-chatbot-lsru.onrender.com`);
  console.log(`🔗 Frontend URL: https://rag-chatbot-1-0waf.onrender.com`);
  console.log(`📱 Mobile test: https://rag-chatbot-lsru.onrender.com/api/mobile-health`);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});