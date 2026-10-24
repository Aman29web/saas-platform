import { roleHasPermission } from "./permissions";

describe("roleHasPermission", () => {
  it("owner can delete the org and manage billing", () => {
    expect(roleHasPermission("owner", "org:delete")).toBe(true);
    expect(roleHasPermission("owner", "org:billing:manage")).toBe(true);
  });

  it("admin cannot delete the org or manage billing", () => {
    expect(roleHasPermission("admin", "org:delete")).toBe(false);
    expect(roleHasPermission("admin", "org:billing:manage")).toBe(false);
  });

  it("admin can invite and remove members; member cannot", () => {
    expect(roleHasPermission("admin", "members:invite")).toBe(true);
    expect(roleHasPermission("admin", "members:remove")).toBe(true);
    expect(roleHasPermission("member", "members:invite")).toBe(false);
    expect(roleHasPermission("member", "members:remove")).toBe(false);
  });

  it("member can use the core feature set but not delete projects", () => {
    expect(roleHasPermission("member", "projects:create")).toBe(true);
    expect(roleHasPermission("member", "projects:update")).toBe(true);
    expect(roleHasPermission("member", "projects:delete")).toBe(false);
  });

  it("admin and owner can delete projects", () => {
    expect(roleHasPermission("admin", "projects:delete")).toBe(true);
    expect(roleHasPermission("owner", "projects:delete")).toBe(true);
  });

  it("only owner can change member roles", () => {
    expect(roleHasPermission("owner", "members:role:change")).toBe(true);
    expect(roleHasPermission("admin", "members:role:change")).toBe(false);
    expect(roleHasPermission("member", "members:role:change")).toBe(false);
  });
});
