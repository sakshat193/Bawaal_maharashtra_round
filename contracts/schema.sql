-- Fair Drop schema. Copied from the four-person build plan (Oct 3, 2026).
-- FROZEN: any change needs approval from the other three members and a bump
-- to info.version in contracts/openapi.yaml.
-- Target: Postgres 16. Owner: Member 2.

CREATE TABLE drops (
  drop_id              UUID PRIMARY KEY,
  name                 TEXT NOT NULL,
  venue                TEXT NOT NULL,
  starts_at            TIMESTAMPTZ NOT NULL,      -- the concert itself
  opens_at             TIMESTAMPTZ NOT NULL,      -- registration window
  closes_at            TIMESTAMPTZ NOT NULL,
  allocation_mode      TEXT NOT NULL CHECK (allocation_mode IN ('lottery_wil','fcfs')),
  pow_required         BOOLEAN NOT NULL,
  turnstile_required   BOOLEAN NOT NULL,
  pow_bits             SMALLINT NOT NULL,         -- per sub-puzzle
  pow_k                SMALLINT NOT NULL DEFAULT 16,
  pow_memory_kib       INTEGER  NOT NULL DEFAULT 2048,
  max_quantity         SMALLINT NOT NULL DEFAULT 4 CHECK (max_quantity BETWEEN 1 AND 4),
  offer_ttl_s          INTEGER  NOT NULL DEFAULT 600,
  pay_deadline_s       INTEGER  NOT NULL DEFAULT 300,   -- payment window after redeem
  max_promotion_rounds SMALLINT NOT NULL DEFAULT 6,
  sybil_rules          JSONB    NOT NULL DEFAULT '[]',  -- frozen, part of config_hash
  drand_chain          TEXT NOT NULL,
  drand_round          BIGINT NOT NULL,
  config_hash          CHAR(64) NOT NULL,
  phase                TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (phase IN ('scheduled','open','sealed','drawn','settled'))
);

CREATE TABLE tiers (
  drop_id     UUID NOT NULL REFERENCES drops,
  tier_id     TEXT NOT NULL,                         -- 'gold', 'silver'
  name        TEXT NOT NULL,
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  capacity    INTEGER NOT NULL CHECK (capacity >= 0),
  held        INTEGER NOT NULL DEFAULT 0,            -- offered + payment_pending + confirmed
  general_sale_units INTEGER NOT NULL DEFAULT 0,     -- released after the last promotion round
  CHECK (held >= 0 AND held <= capacity),            -- the database refuses an oversell
  PRIMARY KEY (drop_id, tier_id)
);

CREATE TABLE entries (
  entry_id            CHAR(32) PRIMARY KEY,          -- random 128-bit hex, public
  drop_id             UUID NOT NULL,
  identity_id         TEXT NOT NULL,                 -- from the JWT, never published
  tier_id             TEXT NOT NULL,
  quantity            SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 4),
  account_created_at  TIMESTAMPTZ,                   -- risk facts, copied from the verified JWT
  device_hash         TEXT,                          -- never from the request body
  payment_fingerprint TEXT,                          -- never published
  pow_issued_at       TIMESTAMPTZ,
  pow_nonces          BIGINT[],
  eligible            BOOLEAN,                       -- NULL until the seal
  exclusion_reason    TEXT,                          -- 'pow_invalid' or 'sybil:<rule_id>'
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  client_subnet       TEXT,                          -- /24 or /48 only; admin view, never published
  UNIQUE (drop_id, identity_id),
  FOREIGN KEY (drop_id, tier_id) REFERENCES tiers
);

CREATE TABLE snapshots (
  drop_id         UUID PRIMARY KEY REFERENCES drops,
  sealed_at       TIMESTAMPTZ NOT NULL,
  entry_count     INTEGER NOT NULL,
  canonical_blob  BYTEA NOT NULL,
  canonical_hash  CHAR(64) NOT NULL,
  exclusions_blob BYTEA NOT NULL,
  exclusions_hash CHAR(64) NOT NULL,                 -- also inside the snapshot header
  timestamp_proof TEXT,                              -- OpenTimestamps receipt and public commit URL
  timestamped_at  TIMESTAMPTZ                        -- must be before round R is due
);

CREATE TABLE draws (
  drop_id     UUID PRIMARY KEY REFERENCES drops,
  drand_round BIGINT NOT NULL,
  signature   TEXT NOT NULL,
  randomness  CHAR(64) NOT NULL,
  relays      TEXT[] NOT NULL,
  drawn_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE ranks (
  drop_id  UUID NOT NULL,
  entry_id CHAR(32) NOT NULL REFERENCES entries,
  rank     INTEGER NOT NULL,                         -- 1 is best
  PRIMARY KEY (drop_id, entry_id),
  UNIQUE (drop_id, rank)
);

CREATE TABLE offers (
  offer_id     UUID PRIMARY KEY,
  drop_id      UUID NOT NULL,
  entry_id     CHAR(32) NOT NULL REFERENCES entries,
  tier_id      TEXT NOT NULL,
  quantity     SMALLINT NOT NULL,
  round        SMALLINT NOT NULL,                    -- 0 initial, 1..N promotion
  status       TEXT NOT NULL CHECK (status IN
                 ('offered','payment_pending','confirmed',
                  'expired','declined','payment_failed')),
  expires_at   TIMESTAMPTZ NOT NULL,                 -- offer deadline
  pay_deadline TIMESTAMPTZ,                          -- set on redeem
  order_id     TEXT UNIQUE,                          -- set on redeem, the idempotency key
  confirmed_at TIMESTAMPTZ,
  UNIQUE (drop_id, entry_id)                         -- one offer per entry, ever
);
