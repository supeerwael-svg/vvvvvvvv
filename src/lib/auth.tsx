import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, Institution } from './types';
import { preloadInstitutionData, syncPending } from './sync';
import { localGetAll } from './offline-db';
import type { ClassAssignment } from './types';

interface JoinRequestInfo {
  status: 'pending' | 'accepted' | 'rejected';
  institutionName: string;
  createdAt: string;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  institution: Institution | null;
  loading: boolean;
  joinRequestInfo: JoinRequestInfo | null;
  assignedClassIds: Set<string>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpAdmin: (email: string, password: string, fullName: string, institutionName: string) => Promise<{ error: string | null }>;
  registerSupervisor: (email: string, password: string, fullName: string, joiningCode: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinRequestInfo, setJoinRequestInfo] = useState<JoinRequestInfo | null>(null);
  const [assignedClassIds, setAssignedClassIds] = useState<Set<string>>(new Set());

  async function loadProfile(uid: string) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();
    setProfile(prof as Profile | null);

    if (!prof?.institution_id) {
      setInstitution(null);
      try {
        const { data: jrInfo } = await supabase.rpc('get_own_join_request_status');
        if (jrInfo && Array.isArray(jrInfo) && jrInfo.length > 0) {
          const row = jrInfo[0] as { status: string; institution_name: string; created_at: string };
          setJoinRequestInfo({
            status: row.status as 'pending' | 'accepted' | 'rejected',
            institutionName: row.institution_name,
            createdAt: row.created_at,
          });
        } else {
          setJoinRequestInfo(null);
        }
      } catch {
        setJoinRequestInfo(null);
      }
    } else {
      setJoinRequestInfo(null);
      const { data: inst } = await supabase
        .from('institutions')
        .select('*')
        .eq('id', prof.institution_id)
        .maybeSingle();
      setInstitution(inst as Institution | null);
      // Preload all institution data into local IndexedDB for offline use
      if (prof.institution_id) {
        preloadInstitutionData(prof.institution_id).then(() => syncPending()).catch(() => {});
      }
      // Load class assignments for this user (supervisor filtering)
      if (prof.role === 'supervisor') {
        try {
          const { data: ca } = await supabase.from('class_assignments').select('class_id').eq('profile_id', uid);
          setAssignedClassIds(new Set((ca ?? []).map((r: { class_id: string }) => r.class_id)));
        } catch {
          const local = await localGetAll<ClassAssignment>('class_assignments');
          setAssignedClassIds(new Set(local.filter((a) => a.profile_id === uid).map((a) => a.class_id)));
        }
      } else {
        setAssignedClassIds(new Set());
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        withTimeout(loadProfile(data.session.user.id)).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) {
        (async () => { await withTimeout(loadProfile(sess.user.id)); setLoading(false); })();
      } else {
        setProfile(null);
        setInstitution(null);
        setJoinRequestInfo(null);
        setAssignedClassIds(new Set());
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      );
      if (error) return { error: error.message };
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? (e.message === 'timeout' ? 'timeout' : e.message) : String(e) };
    }
  };

  const signUpAdmin = async (email: string, password: string, fullName: string, institutionName: string) => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({ email, password })
      );
      if (error) return { error: error.message };
      if (!data.user) return { error: 'No user returned' };

      const { error: instErr } = await supabase
        .from('institutions')
        .insert({ name: institutionName });
      if (instErr) return { error: instErr.message };

      await supabase.from('profiles').update({ full_name: fullName, email }).eq('user_id', data.user.id);
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? (e.message === 'timeout' ? 'timeout' : e.message) : String(e) };
    }
  };

  const registerSupervisor = async (email: string, password: string, fullName: string, joiningCode: string) => {
    try {
      // 1. Check if account already exists — try signing in first to detect duplicate
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (!signInError) {
        // Account exists and password matches — check for existing join request
        const { data: jrInfo } = await supabase.rpc('get_own_join_request_status');
        if (jrInfo && Array.isArray(jrInfo) && jrInfo.length > 0) {
          const status = (jrInfo[0] as { status: string }).status;
          if (status === 'pending') return { error: 'duplicate_pending_request' };
          if (status === 'accepted') return { error: 'already_member' };
        }
        // Account exists but no join request — submit one
        const { error: rpcErr } = await supabase.rpc('submit_join_request', {
          p_institution_code: joiningCode,
          p_email: email,
          p_full_name: fullName,
        });
        if (rpcErr) return { error: rpcErr.message };
        return { error: null };
      }

      // 2. Account doesn't exist — sign up
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          return { error: 'email_exists_signin' };
        }
        return { error: error.message };
      }
      if (!data.user) return { error: 'No user returned' };

      // 3. Update profile with full name
      await supabase.from('profiles').update({ full_name: fullName, email }).eq('user_id', data.user.id);

      // 4. Submit join request via server-side RPC (validates joining code + expiry)
      const { error: rpcErr } = await supabase.rpc('submit_join_request', {
        p_institution_code: joiningCode,
        p_email: email,
        p_full_name: fullName,
      });
      if (rpcErr) return { error: rpcErr.message };

      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? (e.message === 'timeout' ? 'timeout' : e.message) : String(e) };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setInstitution(null);
    setSession(null);
    setJoinRequestInfo(null);
    setAssignedClassIds(new Set());
  };

  const refreshProfile = async () => {
    if (session) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider value={{ session, profile, institution, loading, joinRequestInfo, assignedClassIds, signIn, signUpAdmin, registerSupervisor, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
