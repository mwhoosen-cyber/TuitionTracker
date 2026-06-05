const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getWorkspaceId() {
    return localStorage.getItem('workspace_id');
}

function setWorkspaceId(id) {
    localStorage.setItem('workspace_id', id);
}
