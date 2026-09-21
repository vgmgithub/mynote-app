-- The anonymous name an install is known by (one word, such as Meharika). A person quotes it to ask for help
-- without telling us who they are. UNIQUE, because two people must never be able to quote the same name: the
-- server swaps a name that is already taken before storing it (lib/store.js claimAlias).
-- Additive and nullable, so an install that predates it simply has none until its next send.

ALTER TABLE installs ADD COLUMN alias VARCHAR(16) NULL;

CREATE UNIQUE INDEX idx_installs_alias ON installs (alias);
