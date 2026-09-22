-- Which market a followed company trades in, so the nightly sweep can fetch India at 08:00 IST and
-- the US at 18:30 IST rather than both at one time. Nullable and additive: rows written before this
-- ran stay valid and simply have no market until the app asks about that company again.
--
-- 'in' / 'us'. Not an exchange and not a country - it is only which of the two cron runs owns the row.
ALTER TABLE stock_usage ADD COLUMN market VARCHAR(2) NULL;

-- The sweep reads "every company in this market, most recent week" on every run, which is exactly
-- this index. Without it the sweep table-scans once per cron.
CREATE INDEX idx_stock_usage_market ON stock_usage (market, week);

-- news_state held only a key and a time (it was a "has this happened" flag). The sweep needs to record
-- what it found as well, so the app can say "today's news is ready" without spending a call to check.
ALTER TABLE news_state ADD COLUMN v TEXT NULL;
