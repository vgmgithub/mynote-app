-- Plans, their prices, and who is on what.
--
-- Three things this has to survive without another migration:
--   1. A PRICE CHANGE. Prices are rows, not columns, and a subscriber's row carries the amount they
--      actually signed at. Changing the price means inserting a new plan_prices row and retiring the
--      old one; nobody already paying is touched, so grandfathering is the default rather than a
--      special case somebody has to remember.
--   2. A NEW PLAN. 'pro_plus' is an INSERT into plans, not a schema change. `rank` is what the app
--      compares, so a higher tier unlocks everything a lower one does without listing features twice.
--   3. LIFETIME, later. period='lifetime' is already legal and already priced; it is only hidden in
--      the app. Switching it on is an UPDATE to active, not a migration.
--
-- What is deliberately NOT here: anything about a person. A subscription is keyed to an install id,
-- the same anonymous value everything else uses, and no email, phone or name is stored.

CREATE TABLE IF NOT EXISTS plans (
  code      VARCHAR(32)  NOT NULL,          -- 'pro', later 'pro_plus'
  name      VARCHAR(64)  NOT NULL,          -- what the app shows: 'Pro Plan'
  -- Entitlement is a ladder, not a set. A higher rank includes everything below it, so a feature asks
  -- "rank >= 10" rather than naming every plan that should have it.
  rank      INT          NOT NULL,
  active    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plan_prices (
  id         INT          NOT NULL AUTO_INCREMENT,
  plan_code  VARCHAR(32)  NOT NULL,
  period     VARCHAR(16)  NOT NULL,         -- 'monthly' | 'annual' | 'lifetime'
  -- Paise. Integer on purpose: money in a float is a bug waiting for a rounding error.
  amount     INT          NOT NULL,
  currency   VARCHAR(3)   NOT NULL DEFAULT 'INR',
  -- The name this sells under, e.g. 'MyNotes Pro - Monthly'. Also what a Razorpay Plan is called, so
  -- the two stay recognisably the same thing when auto-renewal is wired up.
  label      VARCHAR(64)  NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  from_at    DATETIME     NOT NULL,
  -- Razorpay's Plan id for this price, created once on first purchase and cached here so a second
  -- buyer of the same price does not create a second Razorpay Plan. NULL until then, and NULL again
  -- for any period that never sells (lifetime has no gateway plan, because it never renews).
  gateway_plan_id VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_plan_prices_live (plan_code, period, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  id          VARCHAR(64)  NOT NULL,        -- ours, or Razorpay's once auto-renewal exists
  install_id  VARCHAR(64)  NOT NULL,
  plan_code   VARCHAR(32)  NOT NULL,
  period      VARCHAR(16)  NOT NULL,
  -- Frozen at signup. This is what makes a price change safe: raising plan_prices never raises what
  -- somebody already pays, and the receipt for a renewal can always say what was actually charged.
  amount      INT          NOT NULL,
  currency    VARCHAR(3)   NOT NULL DEFAULT 'INR',
  status      VARCHAR(16)  NOT NULL,        -- 'active' | 'cancelled' | 'halted' | 'expired'
  started_at  DATETIME     NOT NULL,
  -- When entitlement runs out. NULL means it never does, which is how lifetime is stored when it
  -- opens - so lifetime needs no second table and no second code path.
  current_end DATETIME     NULL,
  -- When the "your plan is ending" notice was last raised, and for which end date. Storing the date
  -- it was raised FOR (not just a flag) means a renewal re-arms the reminder by itself: the stored
  -- date no longer matches current_end, so the next term gets its own notice.
  reminded_for DATETIME    NULL,
  -- Razorpay's own subscription id, once auto-renewal is wired. Kept separate from our id so a row
  -- exists and works before Razorpay has ever heard of it.
  gateway_id  VARCHAR(64)  NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_subs_install (install_id, status),
  KEY idx_subs_expiry (status, current_end),
  KEY idx_subs_gateway (gateway_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Server settings an admin can change without a deploy. Today it holds the billing test clock, which
-- is what makes a subscription testable: waiting a real month to see a renewal is not a test anybody
-- runs, so staging can make "monthly" mean an hour and the reminder fire fifteen minutes before.
--
-- It is a table rather than an env var deliberately: the admin page has to be able to set it, and a
-- value that needs a redeploy cannot be changed while somebody is mid-test.
CREATE TABLE IF NOT EXISTS settings (
  k  VARCHAR(48) NOT NULL,
  v  TEXT        NOT NULL,
  at DATETIME    NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The one plan that exists today, at the prices being launched.
INSERT IGNORE INTO plans (code, name, rank, active) VALUES ('pro', 'Pro Plan', 10, 1);

INSERT IGNORE INTO plan_prices (plan_code, period, amount, currency, label, active, from_at) VALUES
  ('pro', 'monthly',  4900, 'INR', 'MyNotes Pro - Monthly', 1, NOW()),
  ('pro', 'annual',  39900, 'INR', 'MyNotes Pro - Annual',  1, NOW()),
  -- Priced and ready, switched off. Turning lifetime on is: UPDATE plan_prices SET active = 1 ...
  ('pro', 'lifetime', 129900, 'INR', 'MyNotes Pro - Lifetime', 0, NOW());
