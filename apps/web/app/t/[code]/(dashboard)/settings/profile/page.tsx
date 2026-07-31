"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getUserProfile,
  updateUserProfile,
  getLoginAudit,
  type UserProfile,
  type LoginAuditEntry
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  User,
  Mail,
  Phone,
  Briefcase,
  Building2,
  Shield,
  Clock,
  LogIn,
  Save,
  CheckCircle2
} from "lucide-react";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  LOGIN_SUCCESS: { label: "Login", color: "bg-emerald-100 text-emerald-800" },
  LOGIN_FAILED: { label: "Failed Login", color: "bg-red-100 text-red-700" },
  LOGOUT: { label: "Logout", color: "bg-slate-100 text-slate-700" },
  TOKEN_REFRESH: { label: "Token Refresh", color: "bg-blue-100 text-blue-700" },
  PASSWORD_RESET_REQUEST: {
    label: "Password Reset",
    color: "bg-amber-100 text-amber-800"
  }
};

const ROLE_COLORS: Record<string, string> = {
  VIEWER: "bg-slate-100 text-slate-700",
  CONTROLLER: "bg-blue-100 text-blue-800",
  ADMIN: "bg-emerald-100 text-emerald-800",
  SUPERADMIN: "bg-purple-100 text-purple-800"
};

export default function ProfilePage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [feedback, setFeedback] = useState("");

  const profileQ = useQuery({
    queryKey: ["user-profile"],
    queryFn: () =>
      apiContext
        ? getUserProfile(apiContext)
        : Promise.resolve({ data: null as unknown as UserProfile }),
    enabled: Boolean(apiContext),
    select: (r: { data: UserProfile }) => r.data
  });

  const auditQ = useQuery({
    queryKey: ["login-audit-self"],
    queryFn: () =>
      apiContext
        ? getLoginAudit(apiContext, {
            userId: profileQ.data?.id,
            limit: 20
          })
        : Promise.resolve({ data: [] as LoginAuditEntry[] }),
    enabled: Boolean(apiContext && profileQ.data?.id),
    select: (r: { data: LoginAuditEntry[] }) => r.data ?? []
  });

  const updateMut = useMutation({
    mutationFn: () => updateUserProfile(apiContext!, { name, phone, jobTitle, department }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-profile"] });
      setEditing(false);
      setFeedback("Profile updated successfully.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const profile = profileQ.data;

  function startEditing() {
    if (!profile) return;
    setName(profile.name);
    setPhone(profile.phone ?? "");
    setJobTitle(profile.jobTitle ?? "");
    setDepartment(profile.department ?? "");
    setEditing(true);
    setFeedback("");
  }

  if (profileQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-destructive">Could not load profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary">My Profile</h1>
        <p className="text-sm text-muted-foreground">View and edit your account information</p>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <CheckCircle2 className="h-4 w-4" />
          {feedback}
        </div>
      )}

      {/* Profile Card */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4" /> Account Information
          </CardTitle>
          {!editing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              Edit Profile
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={profile.email} disabled className="bg-muted" />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Job Title</Label>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Financial Controller"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Department</Label>
                  <Input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. Finance"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="teal"
                  size="sm"
                  disabled={updateMut.isPending}
                  onClick={() => updateMut.mutate()}
                >
                  <Save className="mr-1 h-3 w-3" />
                  {updateMut.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{profile.name}</p>
                  <p className="text-xs text-muted-foreground">Full Name</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">{profile.email}</p>
                  <p className="text-xs text-muted-foreground">Email</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">{profile.phone ?? "Not set"}</p>
                  <p className="text-xs text-muted-foreground">Phone</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">{profile.jobTitle ?? "Not set"}</p>
                  <p className="text-xs text-muted-foreground">Job Title</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">{profile.department ?? "Not set"}</p>
                  <p className="text-xs text-muted-foreground">Department</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">
                    {profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : "Never"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last Login ({profile.loginCount} total)
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entity Access */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" /> Entity Access & Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entity assignments found.</p>
          ) : (
            <div className="space-y-2">
              {profile.entities.map((eu) => (
                <div
                  key={eu.entity.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{eu.entity.name}</p>
                      <p className="text-xs text-muted-foreground">{eu.entity.type}</p>
                    </div>
                  </div>
                  <Badge className={`${ROLE_COLORS[eu.role] ?? ""} text-[10px]`}>{eu.role}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Login History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <LogIn className="h-4 w-4" /> Login History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (auditQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No login history recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Date & Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditQ.data ?? []).map((entry) => {
                  const info = ACTION_LABELS[entry.action] ?? {
                    label: entry.action,
                    color: "bg-gray-100"
                  };
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge className={`${info.color} text-[10px]`}>{info.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {entry.ipAddress ?? "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
