-- Website visits: one row per day (India time), two counts. Nothing that identifies anyone - no install id,
-- no IP, no browser detail. 'visitors' counts a browser once a day (the page itself remembers it already
-- counted today), 'views' counts every opening of the website.
CREATE TABLE IF NOT EXISTS site_visits (
  day DATE NOT NULL,
  visitors INT NOT NULL DEFAULT 0,
  views INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
