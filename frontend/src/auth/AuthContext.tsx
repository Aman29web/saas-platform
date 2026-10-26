import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, getActiveOrgId, setActiveOrgId } from "@/lib/api-client";
import type { AuthUser, MembershipSummary, MeResponse, Role } from "@/types";

interface AuthContextValue {
  user: AuthUser | null;
  memberships: MembershipSummary[];
  activeOrgId: string | null;
  activeRole: Role | null;
  loading: boolean;
  isImpersonating: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, orgName: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<MembershipSummary[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(getActiveOrgId());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get<MeResponse>("/api/auth/me");
      setUser(res.data.user);
      setMemberships(res.data.memberships);
      const stored = getActiveOrgId();
      const stillValid = stored && res.data.memberships.some((m) => m.orgId._id === stored);
      const nextOrgId = stillValid ? stored : (res.data.memberships[0]?.orgId._id ?? null);
      setActiveOrgId(nextOrgId);
      setActiveOrgIdState(nextOrgId);
    } catch {
      setUser(null);
      setMemberships([]);
      setActiveOrgId(null);
      setActiveOrgIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await apiClient.post("/api/auth/login", { email, password });
      await refresh();
    },
    [refresh],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string, orgName: string) => {
      const res = await apiClient.post("/api/auth/signup", { name, email, password, orgName });
      setActiveOrgId(res.data.organization.id);
      setActiveOrgIdState(res.data.organization.id);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await apiClient.post("/api/auth/logout");
    setUser(null);
    setMemberships([]);
    setActiveOrgId(null);
    setActiveOrgIdState(null);
  }, []);

  const switchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    setActiveOrgIdState(orgId);
  }, []);

  const activeRole = useMemo(
    () => memberships.find((m) => m.orgId._id === activeOrgId)?.role ?? null,
    [memberships, activeOrgId],
  );

  const value: AuthContextValue = {
    user,
    memberships,
    activeOrgId,
    activeRole,
    loading,
    isImpersonating: Boolean(user?.impersonatorId),
    refresh,
    login,
    signup,
    logout,
    switchOrg,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
