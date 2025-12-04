const config = {
  // For local development
  local: {
    apiBaseUrl: 'http://localhost:5000/api',
  },
  // For production (Render)
  production: {
    apiBaseUrl: 'https://rag-chatbot-lsru.onrender.com/api', 
  }
};

// Auto-detect environment
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1';
                    
const currentConfig = isLocalhost ? config.local : config.production;

export default currentConfig;
