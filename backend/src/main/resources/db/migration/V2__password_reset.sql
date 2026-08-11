-- One outstanding password-reset challenge per account.
--
-- Two columns on app_user rather than a reset_token table. A person can only be part-way
-- through one reset at a time, so a second request should invalidate the first — with a single
-- slot that happens by overwriting, whereas a table would need an explicit sweep of the rows
-- it superseded and would accumulate dead tokens forever without one.
--
-- The hash column is sized for BCrypt (60 chars) like password_hash: the code is stored the
-- same way a password is, because for the few minutes it is live it *is* a password.
ALTER TABLE app_user ADD COLUMN reset_code_hash VARCHAR(100);
ALTER TABLE app_user ADD COLUMN reset_code_expires_at TIMESTAMP;
