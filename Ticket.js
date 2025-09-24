// models/Ticket.js
import mongoose from 'mongoose';
import AutoIncrementFactory from 'mongoose-sequence';

const AutoIncrement = AutoIncrementFactory(mongoose);

const ticketSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, default: 'Aberto' },
  createdAt: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

// Adiciona o campo autoIncrement "ticketNumber"
ticketSchema.plugin(AutoIncrement, { inc_field: 'ticketNumber' });

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;
