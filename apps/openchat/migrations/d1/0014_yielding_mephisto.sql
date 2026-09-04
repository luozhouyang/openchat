-- Custom SQL migration file, put your code below! --
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'create_team')
WHERE name IN ('system_user', 'system_admin')
  AND instr(permissions, '"create_team"') = 0;