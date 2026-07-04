-- Create admin_audit_log table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       VARCHAR(100) NOT NULL,   -- 'kill_room', 'create_workspace', 'delete_workspace', etc.
  actor_id     UUID REFERENCES auth.users(id),
  target       TEXT,                    -- room name, workspace_id, etc.
  metadata     JSONB,                   -- full context snapshot
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_read_audit_log" ON admin_audit_log;
CREATE POLICY "super_admin_read_audit_log" ON admin_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE auth_user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Service role bypasses RLS for insertion
