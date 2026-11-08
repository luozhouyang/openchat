-- Custom SQL migration file, put your code below! --
-- Rebuild user_fts WITHOUT the email column (P2 security: email search lets
-- users probe/enumerate accounts; §6.3/搜索隐私). user_fts is a hand-managed
-- FTS5 table (not part of the drizzle schema snapshot), so this rebuild is
-- intentionally a custom migration.
DROP TRIGGER `user_fts_ai`;
--> statement-breakpoint
DROP TRIGGER `user_fts_au`;
--> statement-breakpoint
DROP TRIGGER `user_fts_ad`;
--> statement-breakpoint
DROP TABLE `user_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `user_fts` USING fts5(
  username,
  nickname,
  name,
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `user_fts_ai` AFTER INSERT ON `users` BEGIN
  INSERT INTO `user_fts`(rowid, username, nickname, name)
  VALUES (new.rowid, new.username, new.nickname, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `user_fts_au` AFTER UPDATE OF username, nickname, name ON `users`
WHEN old.username IS NOT new.username
  OR old.nickname IS NOT new.nickname
  OR old.name IS NOT new.name
BEGIN
  DELETE FROM `user_fts` WHERE rowid = old.rowid;
  INSERT INTO `user_fts`(rowid, username, nickname, name)
  VALUES (new.rowid, new.username, new.nickname, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `user_fts_ad` AFTER DELETE ON `users` BEGIN
  DELETE FROM `user_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
INSERT INTO `user_fts`(rowid, username, nickname, name)
SELECT rowid, username, nickname, name FROM `users`;
