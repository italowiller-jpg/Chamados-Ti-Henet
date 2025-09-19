# Gaianet Ticket System

## Instalação
1. `npm install`
2. `npm run init-db` (cria `data.db` e usuário admin inicial)
3. `npm start`
4. Abra `http://localhost:3000/submit.html` para enviar tickets (público)
5. Abra `http://localhost:3000/` para painel (faça login com admin@gaianet.test / admin123)

> Troque a senha do admin assim que possível.

## Notas
- Código fácil de estender: adicione e-mails automáticos (nodemailer), notificações (socket.io), export CSV, filtros.
- Para produção, proteja a `session secret`, use HTTPS, e migre para Postgres/MySQL se precisar de mais escala.
"# Chamados-Ti-Henet"  
