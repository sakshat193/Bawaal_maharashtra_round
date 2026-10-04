-- Member 3's standalone development schema.
-- Mirrors the Fair Drop build-plan schema so allocation can be developed before
-- the shared contracts/schema.sql lands. Do not apply alongside that shared file.

CREATE TABLE drops (
  drop_id              UUID PRIMARY KEY,
  name                 TEXT NOT NULL,
  venue                TEXT NOT NULL,
  starts_at            TIMESTAMPTZ NOT NULL,
  opens_at             TIMESTAMPTZ NOT NULL,
  closes_at            TIMESTAMPTZ NOT NULL,
  allocation_mode      TEXT NOT NULL CHECK (allocation_mode IN ('lottery_wil', 'fcfs')),
  pow_required         BOOLEAN NOT NULL,
  turnstile_required   BOOLEAN NOT NULL,
  pow_bits             SMALLINT NOT NULL,
  pow_k                SMALLINT NOT NULL DEFAULT 16,
  pow_memory_kib       INTEGER NOT NULL DEFAULT 2048,
  max_quantity         SMALLINT NOT NULL DEFAULT 4 CHECK (max_quantity BETWEEN 1 AND 4),
  offer_ttl_s          INTEGER NOT NULL DEFAULT 600,
  pay_deadline_s       INTEGER NOT NULL DEFAULT 300,
  max_promotion_rounds SMALLINT NOT NULL DEFAULT 6,
  sybil_rules          JSONB NOT NULL DEFAULT '[]',
  drand_chain          TEXT NOT NULL,
  drand_round          BIGINT NOT NULL,
  config_hash          CHAR(64) NOT NULL,
  phase                TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (phase IN ('scheduled', 'open', 'sealed', 'drawn', 'settled'))
);

CREATE TABLE tiers (
  drop_id            UUID NOT NULL REFERENCES drops,
  tier_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  price_paise        INTEGER NOT NULL CHECK (price_paise >= 0),
  capacity           INTEGER NOT NULL CHECK (capacity >= 0),
  held               INTEGER NOT NULL DEFAULT 0,
  general_sale_units INTEGER NOT NULL DEFAULT 0,
  CHECK (held >= 0 AND held <= capacity),
  PRIMARY KEY (drop_id, tier_id)
);

CREATE TABLE entries (
  entry_id            CHAR(32) PRIMARY KEY,
  drop_id             UUID NOT NULL,
  identity_id         TEXT NOT NULL,
  tier_id             TEXT NOT NULL,
  quantity            SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 4),
  account_created_at  TIMESTAMPTZ,
  device_hash         TEXT,
  payment_fingerprint TEXT,
  pow_issued_at       TIMESTAMPTZ,
  pow_nonces          BIGINT[],
  eligible            BOOLEAN,
  exclusion_reason    TEXT,
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
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
  exclusions_hash CHAR(64) NOT NULL,
  timestamp_proof TEXT,
  timestamped_at  TIMESTAMPTZ
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
  rank     INTEGER NOT NULL,
  PRIMARY KEY (drop_id, entry_id),
  UNIQUE (drop_id, rank)
);

CREATE TABLE offers (
  offer_id     UUID PRIMARY KEY,
  drop_id      UUID NOT NULL,
  entry_id     CHAR(32) NOT NULL REFERENCES entries,
  tier_id      TEXT NOT NULL,
  quantity     SMALLINT NOT NULL,
  round        SMALLINT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
                 'offered', 'payment_pending', 'confirmed',
                 'expired', 'declined', 'payment_failed')),
  expires_at   TIMESTAMPTZ NOT NULL,
  pay_deadline TIMESTAMPTZ,
  order_id     TEXT UNIQUE,
  confirmed_at TIMESTAMPTZ,
  UNIQUE (drop_id, entry_id),
  FOREIGN KEY (drop_id, tier_id) REFERENCES tiers
);

CREATE INDEX entries_drop_tier_idx ON entries (drop_id, tier_id);
CREATE INDEX offers_sweeper_idx ON offers (status, expires_at);
CREATE INDEX offers_pay_deadline_idx ON offers (status, pay_deadline);
CREATE INDEX ranks_drop_rank_idx ON ranks (drop_id, rank);
