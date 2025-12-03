import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import config from './config'


axios.defaults.baseURL = config.apiBaseUrl;
axios.defaults.headers.post['Content-Type'] = 'application/json';
axios.defaults.headers.common['Accept'] = 'application/json';
axios.defaults.withCredentials = false; // Important for Render
axios.defaults.timeout = 10000; // 10 second timeout for mobile

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [pdfs, setPdfs] = useState([]);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chatHistories, setChatHistories] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Check authentication on mount
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setIsLoggedIn(true);
      fetchPDFs();
      fetchChatHistories();
    }
  }, [token]);

  // Scroll to bottom of messages
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Handle login
  const handleLogin = async (email, password) => {
    try {
      const response = await axios.post('/auth/login', { email, password });
      const { token } = response.data;
      setToken(token);
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setIsLoggedIn(true);
      fetchPDFs();
      fetchChatHistories();
    } catch (error) {
      alert('Login failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle register
  const handleRegister = async (name, email, password) => {
    try {
      const response = await axios.post('/auth/register', { name, email, password });
      alert('Registration successful! Please login.');
    } catch (error) {
      alert('Registration failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Fetch PDFs
  const fetchPDFs = async () => {
    try {
      const response = await axios.get('/pdfs');
      setPdfs(response.data.pdfs);
    } catch (error) {
      console.error('Failed to fetch PDFs:', error);
    }
  };

  // Fetch chat histories
  const fetchChatHistories = async () => {
    try {
      const response = await axios.get('/chat/histories');
      setChatHistories(response.data.chatHistories);
    } catch (error) {
      console.error('Failed to fetch chat histories:', error);
    }
  };

  // Handle PDF upload
  const handleUpload = async (file) => {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('pdf', file);
    
    setUploading(true);
    try {
      const response = await axios.post('/pdfs/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      alert('PDF uploaded successfully!');
      fetchPDFs();
      fileInputRef.current.value = '';
    } catch (error) {
      alert('Upload failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setUploading(false);
    }
  };

  // Handle PDF selection
  const handleSelectPDF = async (pdf) => {
    setSelectedPdf(pdf);
    setActiveChatId(null);
    setMessages([]);
    
    // Load chat history for this PDF
    try {
      const response = await axios.get(`/chat/history/${pdf._id}`);
      if (response.data.messages && response.data.messages.length > 0) {
        setMessages(response.data.messages);
        setActiveChatId(response.data.chatHistoryId);
      } else {
        // Start new chat with welcome message
        setMessages([{
          role: 'assistant',
          content: `Hi! I'm ready to answer questions about "${pdf.filename}". What would you like to know?`,
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      // Start new chat anyway
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm ready to answer questions about "${pdf.filename}". What would you like to know?`,
        timestamp: new Date()
      }]);
    }
  };

  // Handle send message
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedPdf) return;
    
    const userMessage = inputMessage.trim();
    setInputMessage('');
    
    // Add user message to UI immediately
    const userMsgObj = {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsgObj]);
    
    setLoading(true);
    
    try {
      const response = await axios.post('/chat', {
        message: userMessage,
        pdfId: selectedPdf._id
      });
      
      // Add assistant response
      const assistantMsgObj = {
        role: 'assistant',
        content: response.data.response,
        timestamp: new Date(),
        source: response.data.source
      };
      setMessages(prev => [...prev, assistantMsgObj]);
      
      // Update active chat ID if new
      if (response.data.chatHistoryId && response.data.chatHistoryId !== activeChatId) {
        setActiveChatId(response.data.chatHistoryId);
      }
      
      // Refresh chat histories
      fetchChatHistories();
      
    } catch (error) {
      console.error('Chat error:', error);
      
      // Add error message
      const errorMsgObj = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        error: true
      };
      setMessages(prev => [...prev, errorMsgObj]);
    } finally {
      setLoading(false);
    }
  };

  // Handle delete PDF
  const handleDeletePDF = async (pdfId, e) => {
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this PDF?')) return;
    
    try {
      await axios.delete(`/pdfs/${pdfId}`);
      
      // Also delete chat histories for this PDF
      await axios.delete(`/chat/history/pdf/${pdfId}`);
      
      alert('PDF deleted successfully!');
      
      // Clear if it was selected
      if (selectedPdf?._id === pdfId) {
        setSelectedPdf(null);
        setMessages([]);
        setActiveChatId(null);
      }
      
      fetchPDFs();
      fetchChatHistories();
      
    } catch (error) {
      alert('Delete failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle load chat history
  const handleLoadChatHistory = async (chatHistory) => {
    try {
      const response = await axios.get(`/chat/history/${chatHistory.pdfId}`);
      
      // Find the PDF
      const pdf = pdfs.find(p => p._id === chatHistory.pdfId);
      if (pdf) {
        setSelectedPdf(pdf);
        setMessages(response.data.messages);
        setActiveChatId(response.data.chatHistoryId);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  };

  // Handle delete chat history
  const handleDeleteChatHistory = async (chatId, e) => {
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this chat history?')) return;
    
    try {
      await axios.delete(`/chat/history/${chatId}`);
      
      // Clear if it was active
      if (activeChatId === chatId) {
        setMessages([{
          role: 'assistant',
          content: selectedPdf ? 
            `Hi! I'm ready to answer questions about "${selectedPdf.filename}". What would you like to know?` :
            'Please select a PDF to start chatting.',
          timestamp: new Date()
        }]);
        setActiveChatId(null);
      }
      
      fetchChatHistories();
      
    } catch (error) {
      alert('Failed to delete chat history: ' + error.message);
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setIsLoggedIn(false);
    setPdfs([]);
    setSelectedPdf(null);
    setMessages([]);
    setChatHistories([]);
    delete axios.defaults.headers.common['Authorization'];
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Login/Register Component
  if (!isLoggedIn) {
    return <AuthComponent onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>📚 PDF Chatbot</h2>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>

        {/* Upload Section */}
        <div className="upload-section">
          <h3>Upload PDF</h3>
          <input
            type="file"
            ref={fileInputRef}
            accept=".pdf"
            onChange={(e) => handleUpload(e.target.files[0])}
            disabled={uploading}
          />
          {uploading && <p>Uploading...</p>}
        </div>

        {/* PDF List */}
        <div className="pdf-list">
          <h3>Your PDFs ({pdfs.length})</h3>
          {pdfs.length === 0 ? (
            <p className="empty-state">No PDFs uploaded yet</p>
          ) : (
            <ul>
              {pdfs.map(pdf => (
                <li
                  key={pdf._id}
                  className={`pdf-item ${selectedPdf?._id === pdf._id ? 'active' : ''}`}
                  onClick={() => handleSelectPDF(pdf)}
                >
                  <div className="pdf-info">
                    <span className="pdf-name">{pdf.filename}</span>
                    <span className="pdf-date">{formatDate(pdf.uploadedAt)}</span>
                    <span className="pdf-size">{(pdf.fileSize / 1024).toFixed(1)} KB</span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeletePDF(pdf._id, e)}
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Chat History */}
        <div className="chat-history">
          <h3>Chat History</h3>
          {chatHistories.length === 0 ? (
            <p className="empty-state">No chat history</p>
          ) : (
            <ul>
              {chatHistories.map(chat => (
                <li
                  key={chat._id}
                  className={`history-item ${activeChatId === chat._id ? 'active' : ''}`}
                  onClick={() => handleLoadChatHistory(chat)}
                >
                  <div className="history-info">
                    <span className="history-title">{chat.title || chat.pdfName}</span>
                    <span className="history-date">{formatDate(chat.lastActive)}</span>
                    <span className="history-messages">{chat.messageCount} messages</span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteChatHistory(chat._id, e)}
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        {/* Chat Header */}
        <div className="chat-header">
          {selectedPdf ? (
            <>
              <h2>{selectedPdf.filename}</h2>
              <p>Uploaded: {formatDate(selectedPdf.uploadedAt)} • Size: {(selectedPdf.fileSize / 1024).toFixed(1)} KB</p>
              <p className="chat-id">Chat ID: {activeChatId ? activeChatId.substring(0, 8) + '...' : 'New Chat'}</p>
            </>
          ) : (
            <h2>Select a PDF to start chatting</h2>
          )}
        </div>

        {/* Messages Container */}
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome-message">
              <h3>Welcome to PDF Chatbot! 👋</h3>
              <p>Select a PDF from the sidebar to start asking questions about it.</p>
              <p>You can upload new PDFs, view chat history, and have persistent conversations.</p>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`message ${msg.role === 'user' ? 'user-message' : 'assistant-message'} ${msg.error ? 'error-message' : ''}`}
              >
                <div className="message-header">
                  <span className="message-role">
                    {msg.role === 'user' ? '👤 You' : '🤖 Assistant'}
                    {msg.source && <span className="message-source"> • {msg.source}</span>}
                  </span>
                  <span className="message-time">
                    {msg.timestamp ? formatDate(msg.timestamp) : 'Just now'}
                  </span>
                </div>
                <div className="message-content">{msg.content}</div>
                {msg.error && (
                  <div className="error-note">Note: This message indicates an error occurred.</div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={selectedPdf ? `Ask about "${selectedPdf.filename}"...` : 'Select a PDF first...'}
            disabled={!selectedPdf || loading}
          />
          <button
            onClick={handleSendMessage}
            disabled={!selectedPdf || !inputMessage.trim() || loading}
          >
            {loading ? '⏳' : '📤'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Auth Component
function AuthComponent({ onLogin, onRegister }) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLogin) {
      onLogin(email, password);
    } else {
      onRegister(name, email, password);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength="6"
          />
          <button type="submit">{isLogin ? 'Login' : 'Register'}</button>
        </form>
        <p onClick={() => setIsLogin(!isLogin)} className="auth-toggle">
          {isLogin ? "Don't have an account? Register" : "Already have an account? Login"}
        </p>
      </div>
    </div>
  );
}

export default App;