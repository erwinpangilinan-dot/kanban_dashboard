DROP INDEX IF EXISTS idx_tasks_column;
DROP INDEX IF EXISTS idx_columns_board;
DROP INDEX IF EXISTS idx_boards_project;

DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS columns;
DROP TABLE IF EXISTS boards;
DROP TABLE IF EXISTS projects;

DROP TYPE IF EXISTS task_priority;
