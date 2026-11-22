import { canViewStaff } from './staff-positions.mjs';
import { json } from './security.mjs';

export function canReadActionLogs(session) {
  return session?.status==='active' && canViewStaff(session.journal_position);
}

export async function actionLogs(db,params) {
  const actor=params.get('actor')||'';
  const before=Number(params.get('before')||0);
  if(actor.length>100||!Number.isSafeInteger(before)||before<0)return json({error:'Неверные параметры поиска.'},400);
  const {results}=await db.prepare(`
    SELECT a.rowid AS cursor,a.action,a.created_at,staff.nickname AS actor,
      COALESCE(s.moderator_name,m.nickname,former.nickname,manual.title,target_user.display_name,a.target_id) AS target,
      CASE WHEN s.id IS NOT NULL THEN s.reason
           WHEN a.action='moderator_removed' THEN former.removal_reason END AS reason,
      s.type AS sanction_type
    FROM auth_audit a
    JOIN auth_users u ON u.id=a.actor_id AND u.status='active'
    JOIN moderators staff ON (u.provider='vk' AND staff.vk_id=u.provider_id)
                          OR (u.provider='telegram' AND staff.telegram_id=u.provider_id)
    LEFT JOIN staff_journal_controls controls ON controls.moderator_id=staff.id
    LEFT JOIN auth_audit original ON a.action='rollback:'||original.id
    LEFT JOIN staff_sanctions s ON s.id=a.target_id AND COALESCE(original.action,a.action) LIKE 'staff_sanction_%'
    LEFT JOIN moderators m ON m.id=a.target_id AND (a.action LIKE 'moderator_%' OR a.action IN ('staff_activity_adjusted','staff_activity_cleared','staff_logs_cleared','staff_positions_cleared'))
    LEFT JOIN former_moderators former ON former.id=(SELECT fm.id FROM former_moderators fm
        WHERE fm.id=a.target_id OR fm.source_id=a.target_id ORDER BY fm.removed_at DESC LIMIT 1)
      AND a.action LIKE 'moderator_%'
    LEFT JOIN manuals manual ON manual.id=a.target_id AND a.action LIKE 'manual_%'
    LEFT JOIN auth_users target_user ON target_user.id=a.target_id AND a.action LIKE 'access:%'
    WHERE (?=0 OR a.rowid<?) AND (?='' OR staff.id=?)
      AND a.rowid>COALESCE(controls.hide_logs_through,0)
      AND a.hidden_from_staff_logs=0
      AND COALESCE(original.action,a.action) NOT GLOB 'ban_form_*'
    ORDER BY a.rowid DESC LIMIT 41`).bind(before,before,actor,actor).all();
  const entries=results.slice(0,40);
  const {results:actors}=await db.prepare(`
    SELECT id,nickname AS name FROM moderators ORDER BY nickname COLLATE NOCASE,id`).all();
  return json({entries,actors,next:results.length>40?entries.at(-1).cursor:null});
}
