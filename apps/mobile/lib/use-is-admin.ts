import { useProfile } from './use-profile';

// True if the signed-in user has an admin-or-owner role on their profile.
// Backed by useProfile() so it shares the same Tanstack Query cache.
//
// Use to gate admin-only UI:
//   const isAdmin = useIsAdmin();
//   if (!isAdmin) return null;
//
// Database write attempts are independently blocked by RLS (`is_admin()`
// helper in 20260506184010_admin_role_rls.sql) — this hook is just for
// hiding/showing UI elements.
export function useIsAdmin(): boolean {
  const { data: profile } = useProfile();
  const role = profile?.role;
  return role === 'admin' || role === 'owner';
}
