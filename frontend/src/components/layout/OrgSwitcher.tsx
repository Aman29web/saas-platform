import { useAuth } from "@/auth/AuthContext";
import { Select } from "@/components/ui/Select";

export function OrgSwitcher() {
  const { memberships, activeOrgId, switchOrg } = useAuth();

  if (memberships.length === 0) return null;

  if (memberships.length === 1) {
    return <div className="truncate text-xs text-slate-500">{memberships[0].orgId.name}</div>;
  }

  return (
    <Select value={activeOrgId ?? ""} onChange={(e) => switchOrg(e.target.value)} className="text-xs">
      {memberships.map((m) => (
        <option key={m.orgId._id} value={m.orgId._id}>
          {m.orgId.name} ({m.role})
        </option>
      ))}
    </Select>
  );
}
