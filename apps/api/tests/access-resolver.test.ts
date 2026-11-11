import { describe, expect, it } from "vitest";
import {
  canOpenEntity,
  hasEntityPermission,
  hasTenantPermission,
  openableEntityIds,
  resolveAccess,
  type AccessAssignment,
  type AccessEntityNode
} from "../src/modules/access/resolver.js";

// Tree used throughout:
//
//   group ─┬─ cluster ─┬─ propA
//          │           └─ propB
//          └─ propC
//   other  (a second root, unrelated to `group`)
const TREE: AccessEntityNode[] = [
  { id: "group", parentId: null, isActive: true },
  { id: "cluster", parentId: "group", isActive: true },
  { id: "propA", parentId: "cluster", isActive: true },
  { id: "propB", parentId: "cluster", isActive: true },
  { id: "propC", parentId: "group", isActive: true },
  { id: "other", parentId: null, isActive: true }
];

const ROLES = new Map<string, string[]>([
  ["accountant", ["GL_READ", "GL_POST"]],
  ["viewer", ["GL_READ"]],
  ["budgeter", ["BUDGET_WRITE"]],
  ["admin", ["ADMIN_USERS", "GL_READ"]],
  ["empty", []]
]);

function resolve(assignments: AccessAssignment[], entities = TREE, roles = ROLES) {
  return resolveAccess({ entities, assignments, rolePermissions: roles });
}

describe("resolveAccess", () => {
  describe("no assignments", () => {
    it("opens nothing and grants nothing", () => {
      const access = resolve([]);
      expect(access.tenantPermissions).toEqual([]);
      expect(access.entityPermissions).toEqual({});
      expect(canOpenEntity(access, "propA")).toBe(false);
      expect(hasEntityPermission(access, "propA", "GL_READ")).toBe(false);
      expect(hasTenantPermission(access, "GL_READ")).toBe(false);
    });
  });

  describe("entity assignments", () => {
    it("grants the role's permissions at the assigned entity only", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "accountant", entityId: "propA" }]);
      expect(openableEntityIds(access)).toEqual(["propA"]);
      expect(hasEntityPermission(access, "propA", "GL_POST")).toBe(true);
      expect(hasEntityPermission(access, "propB", "GL_POST")).toBe(false);
      expect(hasEntityPermission(access, "propC", "GL_POST")).toBe(false);
    });

    it("does not grant anything on a parent or on tenant-level routes", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "accountant", entityId: "propA" }]);
      expect(canOpenEntity(access, "cluster")).toBe(false);
      expect(canOpenEntity(access, "group")).toBe(false);
      expect(access.tenantPermissions).toEqual([]);
      expect(hasTenantPermission(access, "GL_POST")).toBe(false);
    });

    it("keeps different roles on different properties apart (acceptance 1)", () => {
      const access = resolve([
        { scopeType: "ENTITY", roleId: "accountant", entityId: "propA" },
        { scopeType: "ENTITY", roleId: "viewer", entityId: "propB" }
      ]);
      expect(hasEntityPermission(access, "propA", "GL_POST")).toBe(true);
      expect(hasEntityPermission(access, "propB", "GL_READ")).toBe(true);
      expect(hasEntityPermission(access, "propB", "GL_POST")).toBe(false);
      expect(canOpenEntity(access, "propC")).toBe(false);
    });
  });

  describe("inheritance down the tree", () => {
    it("applies a group assignment to every entity below it, at any depth (acceptance 2)", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "accountant", entityId: "group" }]);
      for (const id of ["group", "cluster", "propA", "propB", "propC"]) {
        expect(access.entityPermissions[id]).toEqual(["GL_POST", "GL_READ"]);
      }
    });

    it("does not leak into a separate root", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "accountant", entityId: "group" }]);
      expect(canOpenEntity(access, "other")).toBe(false);
    });

    it("applies a mid-level assignment to its subtree only", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "viewer", entityId: "cluster" }]);
      expect(openableEntityIds(access).sort()).toEqual(["cluster", "propA", "propB"]);
    });

    it("unions an inherited role with a direct one", () => {
      const access = resolve([
        { scopeType: "ENTITY", roleId: "viewer", entityId: "group" },
        { scopeType: "ENTITY", roleId: "budgeter", entityId: "propA" }
      ]);
      expect(access.entityPermissions.propA).toEqual(["BUDGET_WRITE", "GL_READ"]);
      expect(access.entityPermissions.propB).toEqual(["GL_READ"]);
    });
  });

  describe("tenant-wide assignments", () => {
    it("grant on tenant-level routes and at every entity, including other roots", () => {
      const access = resolve([{ scopeType: "TENANT", roleId: "admin" }]);
      expect(access.tenantPermissions).toEqual(["ADMIN_USERS", "GL_READ"]);
      expect(hasTenantPermission(access, "ADMIN_USERS")).toBe(true);
      expect(openableEntityIds(access).sort()).toEqual(TREE.map((e) => e.id).sort());
      expect(hasEntityPermission(access, "other", "ADMIN_USERS")).toBe(true);
    });

    it("are unioned with entity assignments at the entity, not at tenant level", () => {
      const access = resolve([
        { scopeType: "TENANT", roleId: "viewer" },
        { scopeType: "ENTITY", roleId: "budgeter", entityId: "propC" }
      ]);
      expect(access.entityPermissions.propC).toEqual(["BUDGET_WRITE", "GL_READ"]);
      expect(access.entityPermissions.propA).toEqual(["GL_READ"]);
      expect(hasTenantPermission(access, "BUDGET_WRITE")).toBe(false);
    });
  });

  describe("revocation", () => {
    const before: AccessAssignment[] = [
      { scopeType: "ENTITY", roleId: "accountant", entityId: "propA" },
      { scopeType: "ENTITY", roleId: "viewer", entityId: "propB" }
    ];

    it("removes the permissions and the entity when the only assignment goes", () => {
      const after = before.filter((a) => a.roleId !== "accountant");
      expect(hasEntityPermission(resolve(before), "propA", "GL_POST")).toBe(true);
      const access = resolve(after);
      expect(canOpenEntity(access, "propA")).toBe(false);
      expect(hasEntityPermission(access, "propB", "GL_READ")).toBe(true);
    });

    it("keeps what another assignment still grants", () => {
      const access = resolve([
        { scopeType: "ENTITY", roleId: "viewer", entityId: "group" }
        // the direct accountant assignment on propA has been removed
      ]);
      expect(hasEntityPermission(access, "propA", "GL_READ")).toBe(true);
      expect(hasEntityPermission(access, "propA", "GL_POST")).toBe(false);
    });

    it("removing a tenant-wide grant removes tenant-level access", () => {
      expect(
        hasTenantPermission(resolve([{ scopeType: "TENANT", roleId: "admin" }]), "ADMIN_USERS")
      ).toBe(true);
      expect(hasTenantPermission(resolve([]), "ADMIN_USERS")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("lets a user open an entity through a role that has no permissions", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "empty", entityId: "propA" }]);
      expect(canOpenEntity(access, "propA")).toBe(true);
      expect(access.entityPermissions.propA).toEqual([]);
      expect(hasEntityPermission(access, "propA", "GL_READ")).toBe(false);
    });

    it("ignores an assignment whose role is unknown", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "ghost", entityId: "propA" }]);
      expect(access.entityPermissions).toEqual({});
      const tenant = resolve([{ scopeType: "TENANT", roleId: "ghost" }]);
      expect(tenant.entityPermissions).toEqual({});
    });

    it("ignores an assignment whose entity is unknown", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "accountant", entityId: "nope" }]);
      expect(access.entityPermissions).toEqual({});
    });

    it("cannot open an inactive entity, but passes grants through it", () => {
      const tree = TREE.map((e) => (e.id === "cluster" ? { ...e, isActive: false } : e));
      const access = resolve([{ scopeType: "ENTITY", roleId: "viewer", entityId: "group" }], tree);
      expect(canOpenEntity(access, "cluster")).toBe(false);
      expect(hasEntityPermission(access, "propA", "GL_READ")).toBe(true);
      const tenant = resolve([{ scopeType: "TENANT", roleId: "viewer" }], tree);
      expect(canOpenEntity(tenant, "cluster")).toBe(false);
    });

    it("terminates on a cycle in parent links", () => {
      const cyclic: AccessEntityNode[] = [
        { id: "x", parentId: "y", isActive: true },
        { id: "y", parentId: "x", isActive: true }
      ];
      const access = resolve([{ scopeType: "ENTITY", roleId: "viewer", entityId: "x" }], cyclic);
      expect(openableEntityIds(access).sort()).toEqual(["x", "y"]);
    });

    it("treats an entity whose parent is missing as a root", () => {
      const orphan: AccessEntityNode[] = [{ id: "o", parentId: "gone", isActive: true }];
      const access = resolve([{ scopeType: "ENTITY", roleId: "viewer", entityId: "o" }], orphan);
      expect(openableEntityIds(access)).toEqual(["o"]);
    });

    it("compares permission codes case-insensitively and returns them sorted and unique", () => {
      const roles = new Map([
        ["a", ["gl_read", "GL_POST"]],
        ["b", ["GL_READ"]]
      ]);
      const access = resolve(
        [
          { scopeType: "ENTITY", roleId: "a", entityId: "propA" },
          { scopeType: "ENTITY", roleId: "b", entityId: "propA" }
        ],
        TREE,
        roles
      );
      expect(access.entityPermissions.propA).toEqual(["GL_POST", "GL_READ"]);
      expect(hasEntityPermission(access, "propA", "gl_post")).toBe(true);
    });

    it("does not treat inherited object keys as entities", () => {
      const access = resolve([{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }]);
      expect(canOpenEntity(access, "constructor")).toBe(false);
      expect(hasEntityPermission(access, "toString", "GL_READ")).toBe(false);
    });
  });
});
