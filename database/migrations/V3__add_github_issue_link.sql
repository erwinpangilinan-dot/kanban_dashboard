-- Sprint 3: link tasks to GitHub issues

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_repo VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_issue_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue
    ON tasks(github_repo, github_issue_number)
    WHERE github_issue_number IS NOT NULL;
