// models/Ticket.js
import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  ticket_number: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  requester_name: String,
  requester_email: { type: String, required: true },
  requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ticket_token: String,
  status: { 
    type: String, 
    enum: ['new', 'in_progress', 'resolved', 'closed'], 
    default: 'new' 
  },
  urgency: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'], 
    default: 'medium' 
  },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician', default: null },
  assigned_name: String,
  category_id: String,
  sla_hours: Number,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// Remover timestamps automáticos para evitar conflito com seus campos personalizados
ticketSchema.set('timestamps', false);

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;