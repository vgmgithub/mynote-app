-- Website visits: unique visitors for the week and the month. A browser adds one to week_visitors on its first
-- visit of a week (Monday start) and to month_visitors on its first of a month, so adding a period's rows up
-- gives that period's unique visitors. Still numbers only, nothing about the visitor.
ALTER TABLE site_visits ADD COLUMN week_visitors INT NOT NULL DEFAULT 0;
ALTER TABLE site_visits ADD COLUMN month_visitors INT NOT NULL DEFAULT 0;
