CREATE VIRTUAL TABLE `user_fts` USING fts5(
  username,
  nickname,
  name,
  email,
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `user_fts_ai` AFTER INSERT ON `users` BEGIN
  INSERT INTO `user_fts`(rowid, username, nickname, name, email)
  VALUES (new.rowid, new.username, new.nickname, new.name, new.email);
END;
--> statement-breakpoint
CREATE TRIGGER `user_fts_au` AFTER UPDATE OF username, nickname, name, email ON `users`
WHEN old.username IS NOT new.username
  OR old.nickname IS NOT new.nickname
  OR old.name IS NOT new.name
  OR old.email IS NOT new.email
BEGIN
  DELETE FROM `user_fts` WHERE rowid = old.rowid;
  INSERT INTO `user_fts`(rowid, username, nickname, name, email)
  VALUES (new.rowid, new.username, new.nickname, new.name, new.email);
END;
--> statement-breakpoint
CREATE TRIGGER `user_fts_ad` AFTER DELETE ON `users` BEGIN
  DELETE FROM `user_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
INSERT INTO `user_fts`(rowid, username, nickname, name, email)
SELECT rowid, username, nickname, name, email FROM `users`;
