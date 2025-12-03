import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pdfId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PDF',
    required: true,
    index: true
  },
  messages: [messageSchema],
  title: {
    type: String,
    default: 'Chat Session'
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index for faster queries
chatHistorySchema.index({ userId: 1, pdfId: 1, lastActive: -1 });

// Update lastActive timestamp on new message
chatHistorySchema.pre('save', function(next) {
  if (this.isModified('messages')) {
    this.lastActive = new Date();
  }
  next();
});

export default mongoose.model('ChatHistory', chatHistorySchema);