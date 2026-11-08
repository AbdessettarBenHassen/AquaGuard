-- AquaGuard database (Neon Postgres).
--
--   users ── home_members ── homes ── zones ── devices (leak sensor nodes + valve)
--                              │        └── alerts, valve_log
--                              └── contacts (escalation chain)
--
-- History belongs to the ZONE (kitchen, bathroom…), never to a sensor node, so
-- a node can be replaced without losing it.
-- Data minimization: alerts, valve actions, and one overwritten live snapshot
-- per node. No minute-by-minute sensor history is stored.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  avatar        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS homes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  invite_code text UNIQUE NOT NULL,
  -- Escalation timers and language shared by the whole home.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- owner: manages the home and is the only one allowed to turn the water back on.
-- member: sees everything, gets alerts, can close the water.
CREATE TABLE IF NOT EXISTS home_members (
  home_id   uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (home_id, user_id)
);

CREATE TABLE IF NOT EXISTS zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id    uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- kitchen | bathroom | laundry | boiler | garage | other
  icon       text NOT NULL DEFAULT 'other',
  -- Detection thresholds for this zone.
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Usual humidity learned by the node; kept when the node is replaced.
  baseline   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id           text PRIMARY KEY,                 -- node serial, e.g. AG-7F3A21
  kind         text NOT NULL CHECK (kind IN ('real', 'demo')),
  claim_hash   text,                              -- sha256 of the claim code read over Bluetooth
  home_id      uuid REFERENCES homes(id) ON DELETE SET NULL,
  zone_id      uuid REFERENCES zones(id) ON DELETE SET NULL,
  main_user_id uuid REFERENCES users(id) ON DELETE SET NULL,  -- the phone/account that linked it
  key_hash     text UNIQUE,                       -- sha256 of the node's API key (null = unlinked)
  firmware     text,
  live         jsonb,
  live_at      timestamptz,
  -- Valve position the home wants. The node reads it on every check-in.
  valve_target text NOT NULL DEFAULT 'open' CHECK (valve_target IN ('open', 'closed')),
  -- A night pressure test asked from the app; the node runs it on its next check-in.
  test_requested_at timestamptz,
  -- Set when the family was told the node went silent; cleared when it reports again.
  offline_notified_at timestamptz,
  linked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  home_id   uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  id        text NOT NULL,
  position  integer NOT NULL,
  name      text NOT NULL,
  role      text NOT NULL,
  phone     text NOT NULL,
  push      boolean NOT NULL,
  sms       boolean NOT NULL,
  avatar    jsonb,
  PRIMARY KEY (home_id, id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id            uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  zone_id            uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  device_id          text,
  kind               text NOT NULL,            -- leak | hidden_leak | sensor_fault
  source             text NOT NULL,            -- rule | ml | rule+ml | watchdog
  reason             text NOT NULL,
  snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at         timestamptz NOT NULL DEFAULT now(),
  stage              text NOT NULL,
  level              integer NOT NULL DEFAULT 0,
  sms_sent_for_level boolean NOT NULL DEFAULT false,
  deadline           timestamptz,
  timeline           jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution         text,
  resolved_by        text,
  resolved_at        timestamptz,
  advice             jsonb,                    -- AI advice, written once the alert is closed
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every valve change: by the node itself (leak, sensor fault) or by a person.
CREATE TABLE IF NOT EXISTS valve_log (
  id        bigserial PRIMARY KEY,
  home_id   uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  zone_id   uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  action    text NOT NULL CHECK (action IN ('open', 'closed')),
  by_name   text NOT NULL,
  by_kind   text NOT NULL CHECK (by_kind IN ('device', 'person')),
  reason    text,
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_home_started ON alerts (home_id, started_at DESC);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts (home_id) WHERE resolution IS NULL;
CREATE INDEX IF NOT EXISTS members_user ON home_members (user_id);
CREATE INDEX IF NOT EXISTS zones_home ON zones (home_id);
CREATE INDEX IF NOT EXISTS valve_log_zone ON valve_log (zone_id, at DESC);

-- Columns added after the first release (CREATE TABLE IF NOT EXISTS does not add them).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS offline_notified_at timestamptz;
