export function BlockedBadge({ isBlocked }: { isBlocked: boolean }) {
  return isBlocked ? (
    <span className="badge badge-blocked">Blocked</span>
  ) : (
    <span className="badge badge-active">Active</span>
  );
}
