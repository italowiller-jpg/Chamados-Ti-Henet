const mongoose = require('./db');

const ticketSchema = new mongoose.Schema({
  title: String,
  description: String,
  requester_name: String,
  requester_email: String,
  status: { type: String, default: 'new' },
  urgency: { type: String, default: 'medium' },
  assigned_to: String,
  created_at: { type: Date, default: Date.now },
  comments: [{
    user_name: String,
    text: String,
    created_at: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('Ticket', ticketSchema);
