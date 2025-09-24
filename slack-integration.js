// ---------- Início do bloco Slack Integration ----------
// Requer: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, SLACK_REDIRECT_URI
import { WebClient } from '@slack/web-api';
import crypto from 'crypto';
import fetch from 'node-fetch'; // se node <18, senão pode usar global fetch

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI; // configurar no Slack App

// Modelo para token de finalização de cadastro (signup token)
const signupTokenSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  token: String,
  expires_at: Date,
  created_at: { type: Date, default: Date.now }
});
const SignupToken = mongoose.model('SignupToken', signupTokenSchema);

// Helper: verificação da assinatura do Slack (requer raw body)
function verifySlackRequest(req) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!timestamp || !sig) return false;
  // evitar replay attacks: se timestamp velha (>5min) rejeitar
  const fiveMinutes = 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > fiveMinutes) return false;

  const raw = req.body.toString(); // req.body vem como Buffer (usando express.raw)
  const basestring = `v0:${timestamp}:${raw}`;
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  hmac.update(basestring);
  const mySig = 'v0=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
}

// Helper: cria ticket no DB (reuso)
async function createTicketFromSlack({ title, description, urgency, slackUserEmail, slackUserName }) {
  const seq = await getNextSequence('ticket_number');
  const token = crypto.randomBytes(16).toString('hex');
  const t = await Ticket.create({
    ticket_number: seq,
    title,
    description,
    requester_name: slackUserName || 'Slack User',
    requester_email: slackUserEmail || '',
    ticket_token: token,
    urgency: urgency || 'medium'
  });
  return t;
}

// ---------- 1) OAuth Slack (Sign in with Slack) ----------
app.get('/auth/slack', (req, res) => {
  const scopes = encodeURIComponent('users:read.users:read.email'); // we'll request user's email
  // Use oauth.v2 authorize
  const url = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=users:read,users:read.email&redirect_uri=${encodeURIComponent(SLACK_REDIRECT_URI)}`;
  res.redirect(url);
});

app.get('/auth/slack/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');
    // exchange code for token
    const resp = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: SLACK_REDIRECT_URI
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('Slack oauth error', data);
      return res.status(500).send('Slack OAuth failed');
    }

    // authed_user may have an access_token for the user
    const authedUser = data.authed_user || {};
    const userAccessToken = authedUser.access_token;
    const slackUserId = authedUser.id;

    // attempt to get user profile & email using the user access token
    let email = null;
    let displayName = null;
    if (userAccessToken && slackUserId) {
      const uResp = await fetch('https://slack.com/api/users.info', {
        method: 'GET',
        headers: { Authorization: `Bearer ${userAccessToken}` },
        // user param may be passed in query
      });

      const uData = await uResp.json();
      if (uData && uData.ok && uData.user) {
        displayName = (uData.user.profile && (uData.user.profile.real_name || uData.user.profile.display_name)) || uData.user.name;
        email = uData.user.profile && uData.user.profile.email;
      }
    }

    // fallback: try to use bot token + users.lookupByEmail if email isn't available (optional)
    // Create or find local user
    let user = null;
    if (email) user = await User.findOne({ email }).lean();
    if (!user) {
      // create user with role 'operator' and NO password set yet
      const created = await User.create({ name: displayName || 'Slack User', email: email || undefined, role: 'operator' });
      user = created.toObject ? created.toObject() : created;
    } else {
      // if user exists and already has password -> log them in
    }

    // If user has no password (newly created or existing without password) -> create signup token and redirect to set-password page
    const hasPassword = !!(user && user.password);
    if (!hasPassword) {
      const token = crypto.randomBytes(20).toString('hex');
      const st = await SignupToken.create({ user_id: user._id, token, expires_at: new Date(Date.now() + 1000 * 60 * 60) }); // 1h
      // redirect to front-end set password page with token
      const redirectUrl = `/set-password.html?token=${token}`;
      return res.redirect(302, redirectUrl);
    } else {
      // if user has password, create session and redirect to root
      req.session.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
      return res.redirect(302, '/');
    }
  } catch (e) {
    console.error('/auth/slack/callback error', e);
    return res.status(500).send('Internal error');
  }
});

// ---------- 2) Set password endpoint (from set-password.html) ----------
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

    // optional: auto-login
    const u = await User.findById(st.user_id).lean();
    req.session.user = { id: String(u._id), name: u.name, email: u.email, role: u.role };
    safeJson(res, { ok: true, redirect: '/' });
  } catch (e) {
    console.error('POST /set-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- 3) Slash command endpoint (/slack/command) ----------
app.post('/slack/command', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!verifySlackRequest(req)) return res.status(400).send('invalid signature');

    // body is x-www-form-urlencoded in raw buffer
    const params = new URLSearchParams(req.body.toString());
    const command = params.get('command'); // should be /abrir-chamado
    const trigger_id = params.get('trigger_id');
    const user_id = params.get('user_id'); // slack user id
    const channel_id = params.get('channel_id');
    // Open a modal with inputs
    const modalView = {
      type: 'modal',
      callback_id: 'open_ticket_modal',
      title: { type: 'plain_text', text: 'Abrir Chamado' },
      submit: { type: 'plain_text', text: 'Enviar' },
      close: { type: 'plain_text', text: 'Cancelar' },
      blocks: [
        { type: 'input', block_id: 'title_block', element: { type: 'plain_text_input', action_id: 'title_input', placeholder: { type:'plain_text', text:'Ex: Internet instável' } }, label: { type: 'plain_text', text: 'Título' } },
        { type: 'input', block_id: 'desc_block', element: { type: 'plain_text_input', action_id: 'desc_input', multiline: true, placeholder: { type:'plain_text', text:'Descreva o problema...' } }, label: { type: 'plain_text', text: 'Descrição' } },
        { type: 'input', block_id: 'urg_block', element: { type: 'static_select', action_id: 'urg_select', options: [
          { text: { type:'plain_text', text:'Baixa' }, value: 'low' },
          { text: { type:'plain_text', text:'Média' }, value: 'medium' },
          { text: { type:'plain_text', text:'Alta' }, value: 'high' },
          { text: { type:'plain_text', text:'Crítica' }, value: 'critical' }
        ] }, label: { type: 'plain_text', text: 'Urgência' } }
      ]
    };

    // Call Slack views.open using Bot token
    await slackClient.views.open({ trigger_id, view: modalView });

    // immediately respond with 200 to Slack
    return res.status(200).send();
  } catch (e) {
    console.error('/slack/command error', e);
    return res.status(500).send('error');
  }
});

// ---------- 4) Interactions endpoint (modal submissions) ----------
app.post('/slack/interactions', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!verifySlackRequest(req)) return res.status(400).send('invalid signature');
    // Slack sends body like payload=JSON-STRING
    const raw = req.body.toString();
    const params = new URLSearchParams(raw);
    const payloadStr = params.get('payload');
    if (!payloadStr) return res.status(400).send('no payload');

    const payload = JSON.parse(payloadStr);
    // handle view_submission
    if (payload.type === 'view_submission' && payload.view && payload.view.callback_id === 'open_ticket_modal') {
      // extract fields
      const state = payload.view.state.values;
      const title = (state.title_block.title_input.value || '').trim();
      const description = (state.desc_block.desc_input.value || '').trim();
      const urgency = (state.urg_block.urg_select.selected_option.value || 'medium');

      // get user email via users.info - need user token (we have authed user id in payload.user.id)
      let slackUserEmail = null;
      let slackUserName = payload.user?.username || payload.user?.name || payload.user?.id;
      try {
        // attempt to call users.info with bot token (works for many workspaces)
        const info = await slackClient.users.info({ user: payload.user.id });
        if (info && info.user && info.user.profile && info.user.profile.email) {
          slackUserEmail = info.user.profile.email;
          slackUserName = info.user.profile.real_name || info.user.profile.display_name || slackUserName;
        }
      } catch (e) {
        console.warn('users.info failed', e);
      }

      // create ticket internally
      const ticket = await createTicketFromSlack({ title, description, urgency, slackUserEmail, slackUserName });

      // optionally respond to user in Slack (ephemeral)
      const channelId = payload.view.private_metadata || payload.user.id; // no channel given; we'll DM
      try {
        await slackClient.chat.postEphemeral({
          channel: payload.user.id, // ephemeral needs channel; use DM: postMessage to user
          user: payload.user.id,
          text: `✅ Chamado criado: #${ticket.ticket_number} — ${ticket.title}`
        });
      } catch (e) {
        // fallback: post message to user
        try {
          await slackClient.chat.postMessage({ channel: payload.user.id, text: `✅ Chamado criado: #${ticket.ticket_number} — ${ticket.title}` });
        } catch (err) {
          console.warn('cannot post message to user', err);
        }
      }

      // respond 200 with empty body to close modal
      return res.status(200).send();
    }

    // For other interaction types return 200
    return res.status(200).send();
  } catch (e) {
    console.error('/slack/interactions error', e);
    return res.status(500).send('error');
  }
});

// ---------- Fim do bloco Slack Integration ----------
