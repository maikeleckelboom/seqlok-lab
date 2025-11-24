import { invariant } from "../../errors/invariant";

export type BindingRole = "controller" | "processor" | "observer";

export function assertNotDisposed(
  disposed: boolean,
  where: string,
  role: BindingRole,
): void {
  invariant(!disposed, "internal.assertionFailed", `${role} binding disposed`, {
    where,
  });
}
