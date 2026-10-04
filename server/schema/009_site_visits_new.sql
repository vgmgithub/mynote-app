-- Website visits: how many of the day's visitors came for the first time (a browser never counted before).
-- Still a day and numbers only, nothing about the visitor.
ALTER TABLE site_visits ADD COLUMN new_visitors INT NOT NULL DEFAULT 0;
