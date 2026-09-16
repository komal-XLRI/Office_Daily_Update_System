import { PencilIcon } from "lucide-react";
import Link from "next/link";

import { RoleBadge, StatusBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UserDTO } from "@/types";

import { UserStatusButton } from "./user-status-button";

interface UsersTableProps {
  users: UserDTO[];
  /** The signed-in admin; they cannot deactivate themselves. */
  currentUserId: string;
  /** Ids of inactive offices, labelled in the Office column. */
  inactiveOfficeIds: string[];
}

function NotSet({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function UsersTable({ users, currentUserId, inactiveOfficeIds }: UsersTableProps) {
  const inactiveOffices = new Set(inactiveOfficeIds);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-3">Name</TableHead>
            <TableHead className="px-3">Email</TableHead>
            <TableHead className="px-3">Role</TableHead>
            <TableHead className="px-3">Designation</TableHead>
            <TableHead className="px-3">Office</TableHead>
            <TableHead className="px-3">Status</TableHead>
            <TableHead className="px-3 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <TableRow key={user.id}>
                <TableCell className="px-3 font-medium">
                  {user.name}
                  {isSelf ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </TableCell>
                <TableCell className="px-3">{user.email}</TableCell>
                <TableCell className="px-3">
                  <RoleBadge role={user.role} />
                </TableCell>
                <TableCell className="px-3">{user.designation || <NotSet label="Not specified" />}</TableCell>
                <TableCell className="px-3">
                  {user.office ? (
                    <>
                      {user.office.name}
                      {inactiveOffices.has(user.office.id) ? (
                        <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>
                      ) : null}
                    </>
                  ) : user.role === "admin" ? (
                    <span className="text-muted-foreground">All offices</span>
                  ) : (
                    <NotSet label="Not assigned" />
                  )}
                </TableCell>
                <TableCell className="px-3">
                  <StatusBadge isActive={user.isActive} />
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex justify-end gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/users/${user.id}/edit`}>
                        <PencilIcon data-icon="inline-start" aria-hidden="true" />
                        Edit
                        <span className="sr-only"> {user.name}</span>
                      </Link>
                    </Button>
                    {isSelf ? null : (
                      <UserStatusButton userId={user.id} userName={user.name} isActive={user.isActive} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
