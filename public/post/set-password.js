app.post('/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'missing' });
    const st = await SignupToken.findOne({ token });
    if (!st) return res.status(400).json({ error: 'invalid_token' });
    if (st.expires_at < new Date()) { await SignupToken.deleteOne({ _id: st._id }); return res.status(400).json({ error: 'expired' }); }

    const hashed = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(st.user_id, { $set: { password: hashed } });
    await SignupToken.deleteOne({ _id: st._id });

    // Busca usuário atualizado para checar approved
    const u = await User.findById(st.user_id).lean();
    if (!u) return res.status(500).json({ error: 'user_not_found' });

    if (u.approved) {
      // se já aprovado, podemos auto-login
      req.session.user = { id: String(u._id), name: u.name, email: u.email, role: u.role };
      safeJson(res, { ok: true, redirect: '/' });
    } else {
      // se não aprovado, não logar automaticamente; informar que aguarda aprovação
      safeJson(res, { ok: true, message: 'Senha salva. Sua conta aguarda aprovação do administrador antes de permitir acesso.' });
    }
  } catch (e) {
    console.error('POST /set-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});
