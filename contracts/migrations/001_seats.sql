-- Seat selection after the lottery (branch: seat-selection).
-- The lottery still decides WHO gets tickets and how many, per tier. Winners then pick
-- exact seats in their won tier, in rank-ordered waves, so nobody can out-click anyone.
-- Applied by app.migrate after contracts/schema.sql; recorded in schema_migrations.

-- Per-drop seat settings. They are part of config_hash, so they are frozen and
-- published before anyone enters, like the Sybil rules.
ALTER TABLE drops
  ADD COLUMN seat_selection BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN seat_wave_size SMALLINT NOT NULL DEFAULT 25 CHECK (seat_wave_size >= 1),
  ADD COLUMN seat_wave_s    INTEGER  NOT NULL DEFAULT 30 CHECK (seat_wave_s >= 0);

-- One row per seat that is locked (amber) or booked (red). No row = available (green).
-- The primary key is the guarantee that no two offers can hold the same seat at once,
-- whatever the application code does: a second INSERT for the same seat fails.
CREATE TABLE seat_assignments (
  drop_id    UUID     NOT NULL,
  tier_id    TEXT     NOT NULL,
  seat_index INTEGER  NOT NULL CHECK (seat_index >= 0),   -- 0-based, row-major in the venue layout
  offer_id   UUID     NOT NULL REFERENCES offers,
  status     TEXT     NOT NULL CHECK (status IN ('locked','booked')),
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (drop_id, tier_id, seat_index),
  FOREIGN KEY (drop_id, tier_id) REFERENCES tiers
);
CREATE INDEX seat_assignments_offer ON seat_assignments (offer_id);

-- A seat must exist (index < tier capacity), must be in the offer's own tier, and an
-- offer can never hold more seats than its quantity.
CREATE FUNCTION seat_assignment_guard() RETURNS trigger AS $$
DECLARE
  cap INTEGER;
  offer_tier TEXT;
  offer_drop UUID;
  offer_qty SMALLINT;
  holding INTEGER;
BEGIN
  SELECT capacity INTO cap FROM tiers WHERE drop_id = NEW.drop_id AND tier_id = NEW.tier_id;
  IF NEW.seat_index >= cap THEN
    RAISE EXCEPTION 'seat % is outside tier % capacity %', NEW.seat_index, NEW.tier_id, cap
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT drop_id, tier_id, quantity INTO offer_drop, offer_tier, offer_qty FROM offers WHERE offer_id = NEW.offer_id;
  IF offer_drop <> NEW.drop_id OR offer_tier <> NEW.tier_id THEN
    RAISE EXCEPTION 'seat tier does not match the offer tier' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO holding FROM seat_assignments WHERE offer_id = NEW.offer_id;
  IF holding >= offer_qty THEN
    RAISE EXCEPTION 'offer already holds % seats', offer_qty USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER seat_assignment_guard BEFORE INSERT ON seat_assignments
  FOR EACH ROW EXECUTE FUNCTION seat_assignment_guard();

-- Seats follow their offer in the same transaction as the status change:
-- paid -> booked (red); expired, declined or failed -> released (green).
CREATE FUNCTION seat_follow_offer() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    UPDATE seat_assignments SET status = 'booked' WHERE offer_id = NEW.offer_id;
  ELSIF NEW.status IN ('expired', 'declined', 'payment_failed') THEN
    DELETE FROM seat_assignments WHERE offer_id = NEW.offer_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER offers_seat_follow AFTER UPDATE OF status ON offers
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION seat_follow_offer();
