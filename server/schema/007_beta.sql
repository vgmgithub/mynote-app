-- Beta: a free, admin-approved cohort in exchange for weekly feedback (docs/beta-plan.md).
--
-- installs.plan gains a third value, 'beta' (VARCHAR(8) already, no CHECK constraint - see 001_init.sql). It is
-- set and cleared exactly like 'paid' is today, through the same column, by the same admin actions.
--
-- Feedback is stored per ANSWER, not per submission: the owner rates each answer on its own, so a submission's
-- score is a roll-up of its answers rather than one holistic number. The roll-up formula itself is deliberately
-- not fixed here - see server/lib/beta.js `scoreSubmission` - so it can change without a schema change.
--
-- Two Pro price tiers exist ONLY as ordinary rows in the plans/plan_prices tables 006_subscriptions.sql already
-- has (see that file's own note: "a NEW PLAN is an INSERT into plans, not a schema change"). Once someone buys
-- at one of these, they are simply a Pro subscriber whose subscriptions.amount was frozen at that price - the
-- existing renewal machinery (server/lib/webhook.js) already never re-prices a live subscription, which is
-- exactly what makes the Beta Contributor's price "locked for life" true with no new renewal code at all.

CREATE TABLE IF NOT EXISTS beta_cohort (
  id          INT         NOT NULL AUTO_INCREMENT,
  label       VARCHAR(64) NOT NULL,
  start_date  DATE        NOT NULL,
  end_date    DATE        NOT NULL,           -- admin-set; the app never hardcodes a duration
  active      TINYINT(1)  NOT NULL DEFAULT 1,
  finalized_at DATETIME   NULL,               -- when rankCohort was last run for real (not just previewed)
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS beta_requests (
  id            INT         NOT NULL AUTO_INCREMENT,
  install_id    VARCHAR(64) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  requested_at  DATETIME    NOT NULL,
  reviewed_at   DATETIME    NULL,
  reviewed_note VARCHAR(255) NULL,
  -- Which cohort this request was approved into. Set on approval, not on request: a request can sit pending
  -- across a cohort boundary. A fresh request after a termination is always a NEW row (never reactivated), so
  -- re-entry is never automatic - see docs/beta-plan.md "Rules for termination".
  cohort_id     INT         NULL,
  PRIMARY KEY (id),
  KEY idx_beta_req_install (install_id, status),
  KEY idx_beta_req_cohort (cohort_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS beta_feedback (
  id            INT          NOT NULL AUTO_INCREMENT,
  install_id    VARCHAR(64)  NOT NULL,
  cohort_id     INT          NOT NULL,
  week_start    DATE         NOT NULL,        -- the Friday the window opened on (IST)
  submitted_at  DATETIME     NOT NULL,
  comment_title VARCHAR(80)  NULL,            -- a predefined title, or the custom one typed
  comment_body  TEXT         NULL,
  reviewed      TINYINT(1)   NOT NULL DEFAULT 0,
  total_score   DECIMAL(6,2) NULL,            -- cached roll-up of this submission's answer scores; NULL = not yet rated
  PRIMARY KEY (id),
  UNIQUE KEY idx_beta_fb_week (install_id, week_start),   -- one submission per person per window
  KEY idx_beta_fb_cohort (cohort_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS beta_feedback_answers (
  id            INT          NOT NULL AUTO_INCREMENT,
  feedback_id   INT          NOT NULL,
  question_key  VARCHAR(40)  NOT NULL,
  answer_value  TEXT         NULL,
  score         SMALLINT     NULL,            -- the owner's rating of THIS answer; NULL = not yet rated
  admin_note    VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_beta_fa_feedback (feedback_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The one-year purchase window a Beta Member/Contributor gets once THEIR OWN Beta ends. `expires_at` bounds
-- only when the offer can be BOUGHT - once bought, the subscription's own term always runs a full period from
-- the purchase date, same as any other subscription (see server/lib/plans.js periodEnd).
CREATE TABLE IF NOT EXISTS beta_offers (
  id                       INT          NOT NULL AUTO_INCREMENT,
  install_id               VARCHAR(64)  NOT NULL,
  plan_code                VARCHAR(32)  NOT NULL,     -- 'pro_beta_member' | 'pro_beta_contributor'
  expires_at               DATETIME     NOT NULL,
  redeemed_subscription_id VARCHAR(64)  NULL,         -- set once bought; an unredeemed, unexpired row is "active"
  created_at               DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_beta_offer_install (install_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Why the install was last reverted from Beta: 'missed_week' (automatic, no submission for a closed window) or
-- 'not_genuine' (an admin's call after reading a submission). Purely informational for the admin page; cleared
-- on a fresh approval so it never describes the CURRENT stint.
ALTER TABLE installs ADD COLUMN beta_terminated_reason VARCHAR(20) NULL;

-- The two Beta conversion prices. Same rank as 'pro' (10), so entitlement() unlocks everything identically -
-- see lib/plans.js `meetsRank`. Nothing here is a subscription yet; a row here just means the PRICE exists to
-- be sold, same as 'pro' monthly/annual already do.
INSERT IGNORE INTO plans (code, name, `rank`, active) VALUES
  ('pro_beta_member', 'Pro Plan (Beta Member price)', 10, 1),
  ('pro_beta_contributor', 'Pro Plan (Beta Contributor price)', 10, 1);

INSERT IGNORE INTO plan_prices (plan_code, period, amount, currency, label, active, from_at) VALUES
  ('pro_beta_member', 'annual', 29900, 'INR', 'MyNotes Pro - Beta Member price', 1, NOW()),
  ('pro_beta_contributor', 'annual', 19900, 'INR', 'MyNotes Pro - Beta Contributor price', 1, NOW());

-- The first cohort. Six weeks from whenever this migration runs, exactly as long as the owner asked for THIS
-- run - not a number the app or the server code hardcodes. Change the dates here or from the admin page.
INSERT IGNORE INTO beta_cohort (id, label, start_date, end_date, active) VALUES
  (1, 'Beta 1', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 6 WEEK), 1);
