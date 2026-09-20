// Add values from Supabase Project Settings > API.
// Use the publishable/anon key only. Never put the service_role key here.
window.SUPABASE_CONFIG = {
  url: 'https://ynkpstphnbntumssydxn.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlua3BzdHBobmJudHVtc3N5ZHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDY2ODQsImV4cCI6MjEwNTQyMjY4NH0.4NyK40CCenuY8ASkxdOroOGbKa8lVcC1ldO6QHutd1c',
  adminEmails: [
    'sankalp.develop@gmail.com',
    'nextround@admin.com',
    'nextadmin@avinash.com'
  ],
  financeAdminEmail: 'sankalp.develop@gmail.com'
};

window.SUPABASE_CLIENT = window.supabase
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: window.localStorage
      }
    })
  : null;
