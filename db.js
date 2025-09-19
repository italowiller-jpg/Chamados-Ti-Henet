// db.js
const mongoose = require('mongoose');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("ERRO: variável de ambiente MONGO_URI não definida!");
  process.exit(1);
}

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB conectado com sucesso!"))
.catch(err => {
  console.error("Erro ao conectar no MongoDB:", err);
  process.exit(1);
});

module.exports = mongoose;
