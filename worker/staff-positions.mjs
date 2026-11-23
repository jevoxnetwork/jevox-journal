export const staffPositions = ['Владелец', 'Администратор', 'Младший Администратор', 'Менеджер', 'Спектатор', 'Саппорт', 'Шериф', 'Джуниор'];

export function hasStaffRank(position, minimum) {
  const rank = staffPositions.indexOf(position);
  return rank >= 0 && rank <= staffPositions.indexOf(minimum);
}

export function outranks(position, target) {
  const rank = staffPositions.indexOf(position);
  return rank >= 0 && rank < staffPositions.indexOf(target);
}

export const canViewStaffChecks = position => hasStaffRank(position, 'Саппорт');
export const canDeleteStaffChecks = position => hasStaffRank(position, 'Младший Администратор');
export const canViewStaff = position => hasStaffRank(position, 'Спектатор');
export const canEditRoster = position => hasStaffRank(position, 'Менеджер');
export const canManageManuals = position => hasStaffRank(position, 'Администратор');
export const canDeleteFormerRecord = position => hasStaffRank(position, 'Младший Администратор');
export const isSanctionImmune = position => hasStaffRank(position, 'Младший Администратор');

export function canAssignPosition(position, target) {
  if (!canEditRoster(position) || !outranks(position, target)) return false;
  if (position === 'Менеджер') return staffPositions.indexOf(target) >= staffPositions.indexOf('Саппорт');
  return position === 'Владелец' || !hasStaffRank(target, 'Младший Администратор');
}

export function canManageMember(position, target) {
  return canEditRoster(position) && outranks(position, target);
}

export function canEditMember(position, target) {
  return canAssignPosition(position, target) || (position === 'Владелец' && target === 'Владелец');
}

export function canDiscipline(position, target) {
  return canManageMember(position, target) && !isSanctionImmune(target);
}
