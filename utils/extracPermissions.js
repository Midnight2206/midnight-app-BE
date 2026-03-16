export function extractPermissions(user) {
  const permissionSet = new Set();

  user.roles.forEach((userRole) => {
    userRole.role.permissions.forEach((rp) => {
      permissionSet.add(rp.permission.code);
    });
  });

  return [...permissionSet];
}
