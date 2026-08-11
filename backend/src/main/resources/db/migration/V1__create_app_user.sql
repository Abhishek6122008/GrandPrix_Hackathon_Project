-- Accounts, for every provider.
--
-- Written in the SQL subset H2 and Postgres agree on, so one migration file serves local dev,
-- the test suite and the cloud database. That is the whole reason Flyway is here rather than
-- ddl-auto: the schema is reviewed and identical everywhere, instead of inferred per boot.
CREATE TABLE app_user (
    id                VARCHAR(36)  NOT NULL,
    email             VARCHAR(320) NOT NULL,
    password_hash     VARCHAR(100),
    role              VARCHAR(16)  NOT NULL,
    provider          VARCHAR(16)  NOT NULL,
    provider_subject  VARCHAR(128),
    display_name      VARCHAR(120),
    enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP    NOT NULL,
    last_login_at     TIMESTAMP,
    CONSTRAINT pk_app_user PRIMARY KEY (id)
);

-- Email is the login handle, so uniqueness is enforced by the database and not only by the
-- pre-insert check in AuthController: two concurrent registrations would both pass that check.
--
-- Indexed on the raw column rather than LOWER(email): H2 has no functional indexes, and a
-- migration that only runs on Postgres defeats the point of sharing one file. Case handling
-- is done in the application instead, which lowercases every address before it is stored.
CREATE UNIQUE INDEX ix_app_user_email ON app_user (email);

-- External accounts are looked up by (provider, subject) on every authenticated request.
CREATE INDEX ix_app_user_provider_subject ON app_user (provider, provider_subject);
