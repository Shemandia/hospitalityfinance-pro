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

    /** Integrations: view profiles, browse history and files. */
    canIntegrationUser: can("INTEGRATIONS_READ"),
    /** Integrations: run profiles and cancel running executions. */
    canIntegrationPowerUser: can("INTEGRATIONS_RUN"),
    /** Integrations: create, edit and delete profiles, formats, transformations, lookups. */
    canIntegrationDesigner: can("INTEGRATIONS_CONFIG"),
    /** Integrations: configuration export, import and cleardown. */
    canIntegrationAdmin: can("INTEGRATIONS_CONFIG")
  };
}
