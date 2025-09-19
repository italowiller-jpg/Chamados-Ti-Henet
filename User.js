const mongoose = require('./db');

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  role: String,
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
