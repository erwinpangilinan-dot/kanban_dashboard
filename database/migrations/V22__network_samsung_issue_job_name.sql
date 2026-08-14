-- Atlas / Ansible playbook name for the failing job shown on the Issues tab.

ALTER TABLE network_samsung_issue_log
  ADD COLUMN IF NOT EXISTS atlas_job_name TEXT;
