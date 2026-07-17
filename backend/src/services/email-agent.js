const db = require('../db');
const ollama = require('./ollama');
const gemini = require('./gemini');
const workspaceEmail = require('./workspace-email');
const { isConfigured: isGoogleConfigured } = require('./google-auth');

async function getLlmProvider() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM workspace_settings WHERE key = 'email_agent_llm_provider'"
    );
    if (rows.length && rows[0].value === 'gemini') {
      return 'gemini';
    }
  } catch (err) {
    // Default to ollama
  }
  return 'ollama';
}

async function isLlmConfigured() {
  const provider = await getLlmProvider();
  if (provider === 'gemini') {
    return await gemini.isConfigured();
  }
  return ollama.isConfigured();
}

async function chatWithActiveProvider({ messages }) {
  const provider = await getLlmProvider();
  if (provider === 'gemini') {
    return await gemini.chat({ messages });
  } else {
    return await ollama.chat({ messages });
  }
}

const MEMORIA_URL = process.env.MEMORIA_API_URL || 'http://localhost:8765';

async function fetchMemoriaFacts(query) {
  try {
    const res = await fetch(`${MEMORIA_URL}/recall?q=${encodeURIComponent(query)}&limit=5`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch facts from Memoria:', err.message);
    return [];
  }
}

async function saveMemoriaFact(content) {
  try {
    const res = await fetch(`${MEMORIA_URL}/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        memory_type: 'semantic',
        importance: 'medium'
      })
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to save fact in Memoria:', err.message);
    return false;
  }
}

async function processNewEmail(msg) {
  // 1. Fetch full message details
  const fullMsg = await workspaceEmail.getMessage(msg.id);
  const bodySnippet = (fullMsg.body || fullMsg.snippet || '').slice(0, 4000);
  
  // 2. Fetch facts from Memoria
  const profileFacts = await fetchMemoriaFacts('profile email writing style preferences greeting signature details about Erwin Pangilinan');
  const senderFacts = await fetchMemoriaFacts(`information or context about ${fullMsg.from}`);
  
  const mergedFacts = [...profileFacts, ...senderFacts]
    .map((f) => `- ${f.content}`)
    .filter((value, index, self) => self.indexOf(value) === index)
    .join('\n');

  // 3. Compose prompt for Ollama
  const systemPrompt = `You are a personal email assistant for Erwin Pangilinan. Analyze the email and respond ONLY with valid JSON (no markdown fences):
{
  "category": "important" | "advertisement" | "junk" | "information",
  "needs_reply": boolean,
  "reasoning": "brief explanation",
  "proposed_reply": null | { "subject": "string", "body": "string" }
}

Rules:
- important: work inquiries, personal messages, billing/invoices, scheduling, security/accounts.
- advertisement: marketing emails, newsletters, promotional offers.
- junk: spam, unsolicited mail, system alerts, alerts of low importance.
- information: news digests, automated notifications, newsletters that are informational but don't need reply.
- needs_reply=true only when a thoughtful human reply from Erwin is expected.
- proposed_reply must be generated if needs_reply is true and category is "important". Include a polite, concise, professional reply in Erwin's style.

Use the following profile facts about Erwin Pangilinan to customize the reply style and contents:
${mergedFacts || '- Erwin Pangilinan is an Engineer.'}
`;

  const userContent = `From: ${fullMsg.from}\nSubject: ${fullMsg.subject}\nDate: ${fullMsg.date}\n\n${bodySnippet}`;

  try {
    const rawResponse = await chatWithActiveProvider({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    });

    const parsed = ollama.parseJsonContent(rawResponse);
    const category = ['important', 'advertisement', 'junk', 'information'].includes(parsed.category) 
      ? parsed.category 
      : 'information';
    const needsReply = Boolean(parsed.needs_reply) && category === 'important';
    
    let proposedSubject = null;
    let proposedBody = null;
    if (needsReply && parsed.proposed_reply) {
      proposedSubject = parsed.proposed_reply.subject || `Re: ${fullMsg.subject}`;
      proposedBody = parsed.proposed_reply.body || '';
    }

    // Save review record
    await db.query(
      `INSERT INTO email_agent_reviews (
        message_id, thread_id, from_address, subject, body_snippet, category, needs_reply, proposed_subject, proposed_body
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (message_id) DO NOTHING`,
      [
        fullMsg.id,
        fullMsg.thread_id,
        fullMsg.from,
        fullMsg.subject,
        bodySnippet.slice(0, 1000),
        category,
        needsReply,
        proposedSubject,
        proposedBody
      ]
    );

    console.log(`Processed email agent review for message ${fullMsg.id} (${category})`);
  } catch (err) {
    console.error(`Failed to process email agent review for ${fullMsg.id}:`, err.message);
  }
}

async function checkInboxForAgentReviews() {
  if (!isGoogleConfigured()) return;
  const isLlmReady = await isLlmConfigured();
  if (!isLlmReady) return;

  try {
    const messages = await workspaceEmail.listMessages({ q: 'in:inbox', maxResults: 10 });
    for (const msg of messages) {
      // Check if already reviewed
      const { rows } = await db.query(
        'SELECT id FROM email_agent_reviews WHERE message_id = $1',
        [msg.id]
      );
      if (rows.length === 0) {
        await processNewEmail(msg);
      }
    }
  } catch (err) {
    console.error('Email agent inbox scan failed:', err.message);
  }
}

function startEmailAgent() {
  // Check every 5 minutes
  const intervalMs = 5 * 60 * 1000;
  
  const tick = () => {
    checkInboxForAgentReviews().catch((err) => {
      console.error('Email agent check tick failed:', err.message);
    });
  };

  tick();
  setInterval(tick, intervalMs);
  console.log(`Email agent scheduled to monitor inbox every 5 minutes. Memoria URL: ${MEMORIA_URL}`);
}

async function approveAndSendDraft(reviewId, finalBody) {
  const { rows } = await db.query(
    'SELECT * FROM email_agent_reviews WHERE id = $1',
    [reviewId]
  );
  if (!rows.length) throw new Error('Review record not found');
  const review = rows[0];

  // Learn if the user edited the proposed draft
  if (review.proposed_body && review.proposed_body.trim() !== finalBody.trim()) {
    try {
      const learnPrompt = `The user received an email from: ${review.from_address}
Subject: ${review.subject}
Original email body snippet: ${review.body_snippet}

The AI agent proposed this reply:
"${review.proposed_body}"

The user edited the reply to:
"${finalBody}"

Analyze the difference and write a single, short sentence describing the user's preference, writing style, or correction (e.g. "User prefers a casual tone", "User prefers to sign off with 'Thanks, Erwin'", "User prefers to keep replies very brief"). Respond ONLY with that sentence.`;

      const preferenceSentence = await chatWithActiveProvider({
        messages: [{ role: 'user', content: learnPrompt }]
      });

      if (preferenceSentence && preferenceSentence.trim()) {
        const cleanedPreference = preferenceSentence.replace(/^["']|["']$/g, '').trim();
        await saveMemoriaFact(`Email style preference: ${cleanedPreference}`);
        console.log(`Email agent learned user preference: ${cleanedPreference}`);
      }
    } catch (learnErr) {
      console.error('Failed to learn from user edits:', learnErr.message);
    }
  }

  // Send the email reply
  await workspaceEmail.sendMessage({
    to: review.from_address,
    subject: review.proposed_subject || `Re: ${review.subject}`,
    body: finalBody,
    threadId: review.thread_id
  });

  // Update DB status
  await db.query(
    "UPDATE email_agent_reviews SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [reviewId]
  );

  return { success: true };
}

async function rejectDraft(reviewId) {
  const { rows } = await db.query(
    'SELECT message_id FROM email_agent_reviews WHERE id = $1',
    [reviewId]
  );
  if (!rows.length) throw new Error('Review record not found');
  const review = rows[0];

  // Trash the email message
  try {
    await workspaceEmail.deleteMessage(review.message_id);
    console.log(`Trashed email message ${review.message_id} on reject`);
  } catch (err) {
    console.error(`Failed to trash email message ${review.message_id}:`, err.message);
  }

  const { rowCount } = await db.query(
    "UPDATE email_agent_reviews SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [reviewId]
  );
  if (!rowCount) throw new Error('Review record not found');
  return { success: true };
}

async function getPendingReviews() {
  const { rows } = await db.query(
    "SELECT * FROM email_agent_reviews WHERE status = 'pending' ORDER BY created_at DESC"
  );
  return rows;
}

async function getAllReviews(limit = 50) {
  const { rows } = await db.query(
    "SELECT * FROM email_agent_reviews ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

module.exports = {
  startEmailAgent,
  approveAndSendDraft,
  rejectDraft,
  getPendingReviews,
  getAllReviews,
  checkInboxForAgentReviews
};
