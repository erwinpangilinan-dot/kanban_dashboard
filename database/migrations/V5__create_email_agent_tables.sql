-- Email Agent Review Schema

CREATE TABLE IF NOT EXISTS email_agent_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id VARCHAR(255) UNIQUE NOT NULL,
  thread_id VARCHAR(255),
  from_address VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  body_snippet TEXT,
  category VARCHAR(50) NOT NULL, -- important, advertisement, junk, information
  needs_reply BOOLEAN DEFAULT FALSE,
  proposed_subject VARCHAR(500),
  proposed_body TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, sent
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_agent_reviews_message_id ON email_agent_reviews(message_id);
CREATE INDEX IF NOT EXISTS idx_email_agent_reviews_status ON email_agent_reviews(status);
