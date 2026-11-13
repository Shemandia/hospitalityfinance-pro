/**
 * usePermissions — what the signed-in user may do, for menus and buttons.
 *
 * Every answer comes from the access context (GET /api/v1/context) through
 * lib/access.ts, with the same scopes as the API's route guard. Gate a control
 * with the permission of the route it calls, at the scope that route uses:
 *
 *   const { can } = usePermissions();
 *   can("GL_POST")                                     at the selected entity
 *   can("ADMIN_ROLES_MANAGE", "tenant")                 tenant-wide
 *   can("ADMIN_ENTITIES", "any-entity")                 anywhere
 *
 * There are no role names here (AUT-03).
 */

"use client";

import { useCallback } from "react";
import { useAuth } from "./auth-provider";
import { useEntity } from "./entity-provider";
import { allows, type PermissionScope } from "../lib/access";

export function usePermissions() {
  const { context } = useAuth();
  const { entityId } = useEntity();

  const can = useCallback(
    (codes: string | readonly string[], scope: PermissionScope = "entity") =>
      allows(context, scope, codes, entityId),
    [context, entityId]
  );

  return {
    can,

    /** Transfer Desk: view profiles, browse history and files. */
    canTransferDeskUser: can("TRANSFER_DESK_READ"),
    /** Transfer Desk: run profiles and cancel running executions. */
    canTransferDeskPowerUser: can("TRANSFER_DESK_EXECUTE"),
    /** Transfer Desk: create, edit and delete profiles, formats, transformations, lookups. */
    canTransferDeskDesigner: can("TRANSFER_DESK_CONFIG"),
    /** Transfer Desk: configuration export, import and cleardown. */
    canTransferDeskAdmin: can("TRANSFER_DESK_CONFIG")
  };
}
