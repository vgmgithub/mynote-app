-- News proxy storage. Plain MySQL 8, one statement per ';' (scripts/migrate.js splits on it).
--
-- Neither table links a company to a person: the cache is keyed by the company name alone, and the
-- quota table holds a count per install per day and no names.

-- One row per company per day, kept for about ten days (lib/news.js ARCHIVE_DAYS). It is both the cache
-- and the archive: today's row saves an upstream call, and the older rows are what somebody who has not
-- opened the app for four or five days gets back, so a quiet week leaves no hole in their Feed.
-- Public company news only - no holding, quantity or amount is ever stored here.
CREATE TABLE IF NOT EXISTS news_archive (
  name_key   VARCHAR(80) NOT NULL,
  day        DATE        NOT NULL,
  fetched_at DATETIME    NOT NULL,
  name       VARCHAR(80) NOT NULL,
  payload    MEDIUMTEXT  NOT NULL,
  PRIMARY KEY (name_key, day),
  KEY idx_news_archive_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS news_quota (
  install_id VARCHAR(40) NOT NULL,
  day        DATE        NOT NULL,
  n          INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which companies people follow, and how many follow each. Which person follows which stock is not
-- wanted and is not knowable here: `follower` is a one-way hash of the install id, a server secret, the
-- week AND the company, so one person is a different value for every stock and for every week. The rows
-- can be counted per company but can never be grouped into anybody's holdings.
CREATE TABLE IF NOT EXISTS stock_usage (
  name_key VARCHAR(80) NOT NULL,
  week     VARCHAR(8)  NOT NULL,
  follower VARCHAR(32) NOT NULL,
  name     VARCHAR(80) NOT NULL,
  PRIMARY KEY (name_key, week, follower),
  KEY idx_stock_usage_week (week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
