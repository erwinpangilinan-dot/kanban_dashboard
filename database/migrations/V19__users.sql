-- Dashboard user accounts with role and per-tab access control.
-- Replaces the single AUTH_USERNAME/AUTH_PASSWORD identity; those env vars now
-- only seed the first admin (see backend/src/services/users.js).

-- Idempotent; also created in V1. Safe if this file is applied out of order.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
    allowed_views TEXT[] NOT NULL DEFAULT ARRAY['overview'],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Bumped on password change so tokens issued before it stop verifying.
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
