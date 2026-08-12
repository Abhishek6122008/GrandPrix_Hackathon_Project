-- The part of an account a person recognises as themselves.
--
-- display_name already existed from V1 but nothing ever wrote to it; these are the rest of a
-- profile: a picture, a line about who they are, and when they last changed either.

-- A short line, not a free-text field. 280 characters is enough to say "Ops lead, Wembley
-- North" and short enough that it always fits the one line the UI gives it, on a phone too.
ALTER TABLE app_user ADD COLUMN bio VARCHAR(280);

-- The avatar, stored as a data: URI rather than a BLOB or a file path.
--
-- A BLOB would need a second round trip and a streaming endpoint to render one 40px circle in
-- a header; a path would need a filesystem or bucket that this project deliberately does not
-- have (sessions run in memory, the venue store is a folder, and the cloud profile assumes
-- nothing but Postgres). A data URI travels with GET /auth/me and renders with no second
-- request at all.
--
-- VARCHAR(200000), not CLOB or TEXT: it is the one large-string type H2 and Postgres spell the
-- same way, which is the rule this migration set follows. It also caps an avatar at roughly
-- 150KB of image at the database, behind the smaller limit the application enforces first.
ALTER TABLE app_user ADD COLUMN avatar VARCHAR(200000);

ALTER TABLE app_user ADD COLUMN profile_updated_at TIMESTAMP;
