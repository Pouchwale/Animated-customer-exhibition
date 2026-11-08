-- Password changes sign out every other session: each session carries the account's token version.
ALTER TABLE "AdminUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
