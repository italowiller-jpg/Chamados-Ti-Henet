// init-db.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

// Conectar ao MongoDB
await mongoose.connect(process.env.MONGO_URI);
console.log('Conectado ao MongoDB!');

// --- MODELS ---
// User
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Technician
const technicianSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  displayName: String,
  active: { type: Boolean, default: true }
});
const Technician = mongoose.model('Technician', technicianSchema);

// Category
const categorySchema = new mongoose.Schema({
  name: { type: String, unique: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Category = mongoose.model('Category', categorySchema);

// Setting
const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});
const Setting = mongoose.model('Setting', settingSchema);

// --- SEED DATA ---

// 1. Categorias
const categories = ['Rede / Internet', 'Hardware', 'Software', 'Acesso / Senha', 'Solicitação de Serviço'];
for (const name of categories) {
  await Category.updateOne(
    { name },
    { name, active: true, createdAt: new Date() },
    { upsert: true }
  );
}
console.log('Categorias criadas ou atualizadas.');

// 2. Settings
const settings = [
  { key: 'site.title', value: 'Henet - Sistema de Chamados' },
  { key: 'site.subtitle', value: 'Abra um chamado e nossa equipe de TI irá lhe atender.' },
  { key: 'submit.instructions', value: 'Descreva o problema com o máximo de detalhes.' }
];
for (const s of settings) {
  await Setting.updateOne({ key: s.key }, s, { upsert: true });
}
console.log('Settings criadas ou atualizadas.');

// 3. Superadmin
const adminEmail = 'Tiadm@henet.com.br';
const adminPass = 'Grupoti123@';
const adminName = 'Admin Henet';
const saltRounds = 10;

let admin = await User.findOne({ email: adminEmail });
if (!admin) {
  const hash = await bcrypt.hash(adminPass, saltRounds);
  admin = await User.create({
    name: adminName,
    email: adminEmail,
    password: hash,
    role: 'superadmin'
  });
  console.log('Superadmin criado:', adminEmail);
} else {
  admin.role = 'superadmin';
  await admin.save();
  console.log('Superadmin já existia — role garantida.');
}

// 4. Técnico vinculado
const techExists = await Technician.findOne({ userId: admin._id });
if (!techExists) {
  await Technician.create({ userId: admin._id, displayName: adminName, active: true });
  console.log('Técnico vinculado ao superadmin criado.');
} else {
  console.log('Técnico vinculado ao superadmin já existia.');
}

// Finalização
mongoose.connection.close();
console.log('Script finalizado com sucesso.');
