"use client";

/**
 * Transfer Desk — New Profile Wizard Page
 *
 * Renders WizardContainer in create mode.
 * RBAC: requires transfer:designer role.
 */

import { usePermissions } from "../../../../../../../components/use-permissions";
import { WizardContainer } from "../../../../../../../components/transfer-desk/wizard/WizardContainer";
import { Lock } from "lucide-react";

export default function NewTransferProfilePage() {
  const role = usePermissions();

  if (!role.canTransferDeskDesigner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Designer access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          You need at least the <code className="font-mono">transfer:designer</code> role to create
          profiles.
        </p>
      </div>
    );
  }

  return <WizardContainer mode="create" />;
}
