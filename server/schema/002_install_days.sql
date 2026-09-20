-- One row per install per day it checked in: how often people really use the app.
-- Only the random install id and a calendar date; no amounts, names or other detail.
CREATE TABLE IF NOT EXISTS install_days (
  install_id VARCHAR(40) NOT NULL,
  day        DATE        NOT NULL,
  PRIMARY KEY (install_id, day),
  KEY idx_install_days_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
