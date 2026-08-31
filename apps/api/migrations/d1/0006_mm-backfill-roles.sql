-- Custom SQL migration file, put your code below! --

UPDATE team_members SET roles = CASE WHEN role = 'admin' THEN 'team_admin' ELSE 'team_user' END WHERE roles = 'team_user';
UPDATE channel_members SET roles = CASE WHEN role = 'admin' THEN 'channel_admin' ELSE 'channel_user' END;