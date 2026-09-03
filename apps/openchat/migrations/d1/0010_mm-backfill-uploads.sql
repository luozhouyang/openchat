-- Custom SQL migration file, put your code below! --

INSERT INTO uploadsessions (id, type, created_at, user_id, channel_id, filename, path, file_size, file_offset)
SELECT id, content_type, created_at, user_id, channel_id, filename, key, size,
  CASE WHEN status = 'complete' THEN size ELSE 0 END
FROM uploads;

INSERT INTO fileinfo (id, creator_id, post_id, created_at, path, name, size, mime_type)
SELECT id, user_id, NULL, COALESCE(completed_at, created_at), key, filename, size, content_type
FROM uploads
WHERE status = 'complete';