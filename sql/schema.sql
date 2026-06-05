-- ===== Tuition Tracker Database Schema =====
-- Run this in your Supabase SQL Editor

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== Profiles =====
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ===== Workspaces =====
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    split_ratio INTEGER NOT NULL DEFAULT 50,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- ===== Workspace Members =====
CREATE TABLE workspace_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their memberships"
    ON workspace_members FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert memberships"
    ON workspace_members FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Helper function: check if user belongs to workspace
CREATE OR REPLACE FUNCTION user_in_workspace(ws_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = ws_id AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Workspace policies using helper
CREATE POLICY "Members can view workspace"
    ON workspaces FOR SELECT
    USING (user_in_workspace(id));

CREATE POLICY "Anyone can create workspace"
    ON workspaces FOR INSERT
    WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners can update workspace"
    ON workspaces FOR UPDATE
    USING (user_in_workspace(id));

-- ===== Classes =====
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_of_week TEXT,
    time TEXT,
    rate NUMERIC(10,2) NOT NULL DEFAULT 0,
    rate_type TEXT NOT NULL DEFAULT 'per_lesson',
    tutor_id UUID REFERENCES auth.users(id),
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view classes"
    ON classes FOR SELECT USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can insert classes"
    ON classes FOR INSERT WITH CHECK (user_in_workspace(workspace_id));
CREATE POLICY "Members can update classes"
    ON classes FOR UPDATE USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can delete classes"
    ON classes FOR DELETE USING (user_in_workspace(workspace_id));

-- ===== Students =====
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    payment_type TEXT NOT NULL DEFAULT 'per_lesson',
    monthly_rate NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view students"
    ON students FOR SELECT USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can insert students"
    ON students FOR INSERT WITH CHECK (user_in_workspace(workspace_id));
CREATE POLICY "Members can update students"
    ON students FOR UPDATE USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can delete students"
    ON students FOR DELETE USING (user_in_workspace(workspace_id));

-- ===== Class-Student Enrollment =====
CREATE TABLE class_students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_id, student_id)
);

ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view enrollments"
    ON class_students FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));
CREATE POLICY "Members can insert enrollments"
    ON class_students FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));
CREATE POLICY "Members can delete enrollments"
    ON class_students FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));

-- ===== Attendance =====
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'present',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_id, student_id, date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view attendance"
    ON attendance FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));
CREATE POLICY "Members can insert attendance"
    ON attendance FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));
CREATE POLICY "Members can update attendance"
    ON attendance FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));
CREATE POLICY "Members can delete attendance"
    ON attendance FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM classes c WHERE c.id = class_id AND user_in_workspace(c.workspace_id)
    ));

-- ===== Student Ledger =====
CREATE TABLE student_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    debit NUMERIC(10,2) NOT NULL DEFAULT 0,
    credit NUMERIC(10,2) NOT NULL DEFAULT 0,
    ref_type TEXT DEFAULT NULL,
    ref_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ledger"
    ON student_ledger FOR SELECT USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can insert ledger"
    ON student_ledger FOR INSERT WITH CHECK (user_in_workspace(workspace_id));
CREATE POLICY "Members can update ledger"
    ON student_ledger FOR UPDATE USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can delete ledger"
    ON student_ledger FOR DELETE USING (user_in_workspace(workspace_id));

-- ===== Payments =====
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL,
    date DATE NOT NULL,
    comment TEXT DEFAULT '',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view payments"
    ON payments FOR SELECT USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can insert payments"
    ON payments FOR INSERT WITH CHECK (user_in_workspace(workspace_id));
CREATE POLICY "Members can update payments"
    ON payments FOR UPDATE USING (user_in_workspace(workspace_id));
CREATE POLICY "Members can delete payments"
    ON payments FOR DELETE USING (user_in_workspace(workspace_id));

-- ===== Enable Realtime =====
ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE student_ledger;

-- ===== Indexes =====
CREATE INDEX idx_classes_workspace ON classes(workspace_id);
CREATE INDEX idx_students_workspace ON students(workspace_id);
CREATE INDEX idx_attendance_class_date ON attendance(class_id, date);
CREATE INDEX idx_attendance_student ON attendance(student_id);
CREATE INDEX idx_ledger_student ON student_ledger(student_id);
CREATE INDEX idx_ledger_workspace ON student_ledger(workspace_id);
CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX idx_payments_workspace ON payments(workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workspace_invite ON workspaces(invite_code);
