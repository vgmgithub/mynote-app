-- Plain, standard MySQL 8 only: no vendor-specific features, so this dumps and restores on any MySQL host.
-- One statement per ';' (scripts/migrate.js splits on it), and no ';' inside string literals.

CREATE TABLE IF NOT EXISTS installs (
  install_id  VARCHAR(40)  NOT NULL,
  first_seen  DATETIME     NOT NULL,
  last_seen   DATETIME     NOT NULL,
  app_version INT          NOT NULL,
  platform    VARCHAR(12)  NOT NULL,
  plan        VARCHAR(8)   NOT NULL DEFAULT 'free',
  time_zone   VARCHAR(48)  NULL,
  language    VARCHAR(16)  NULL,
  age_band    VARCHAR(12)  NULL,
  gender      VARCHAR(8)   NULL,
  PRIMARY KEY (install_id),
  KEY idx_installs_last_seen (last_seen),
  KEY idx_installs_platform (platform),
  KEY idx_installs_age_band (age_band)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS install_features (
  install_id VARCHAR(40) NOT NULL,
  feature    VARCHAR(16) NOT NULL,
  PRIMARY KEY (install_id, feature),
  KEY idx_install_features_feature (feature)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
