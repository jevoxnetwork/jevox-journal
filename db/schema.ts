import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('auth_users', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  providerId: text('provider_id').notNull(),
  displayName: text('display_name').notNull(),
  username: text('username'),
  picture: text('picture'),
  role: text('role').notNull().default('moderator'),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at').notNull(),
}, t => [uniqueIndex('auth_users_identity').on(t.provider, t.subject)]);

export const sessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrf: text('csrf').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('auth_sessions_user').on(t.userId)]);

export const flows = sqliteTable('auth_flows', {
  stateHash: text('state_hash').primaryKey(),
  browserHash: text('browser_hash').notNull(),
  provider: text('provider').notNull(),
  verifier: text('verifier').notNull(),
  nonce: text('nonce').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const limits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
});

export const audit = sqliteTable('auth_audit', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetId: text('target_id'),
  createdAt: integer('created_at').notNull(),
  hiddenFromStaffLogs: integer('hidden_from_staff_logs').notNull().default(0),
});

export const moderators = sqliteTable('moderators', {
  id: text('id').primaryKey(),
  nickname: text('nickname').notNull(),
  position: text('position').notNull(),
  realName: text('real_name').notNull(),
  birthDate: text('birth_date').notNull(),
  appointmentDate: text('appointment_date'),
  staffSince: text('staff_since'),
  profileBanner: text('profile_banner'),
  discordId: text('discord_id').unique('moderators_discord_id'),
  vkId: text('vk_id'),
  telegramId: text('telegram_id'),
  journalAdmin: integer('journal_admin').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('moderators_nickname').on(t.nickname),uniqueIndex('moderators_vk_id').on(t.vkId),uniqueIndex('moderators_telegram_id').on(t.telegramId)]);

export const manuals = sqliteTable('manuals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull(),
  allowedPositions: text('allowed_positions'),
  authorId: text('author_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const formerModerators = sqliteTable('former_moderators', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  nickname: text('nickname').notNull(),
  position: text('position').notNull(),
  realName: text('real_name').notNull(),
  birthDate: text('birth_date').notNull(),
  appointmentDate: text('appointment_date'),
  staffSince: text('staff_since'),
  profileBanner: text('profile_banner'),
  discordId: text('discord_id'),
  vkId: text('vk_id'),
  telegramId: text('telegram_id'),
  joinedAt: integer('joined_at').notNull(),
  removedAt: integer('removed_at').notNull(),
  removedBy: text('removed_by').notNull(),
  removedByName: text('removed_by_name').notNull(),
  removalReason: text('removal_reason'),
  journalAdmin: integer('journal_admin').notNull().default(0),
  restoredAt: integer('restored_at'),
  restoredBy: text('restored_by'),
});

export const journalNotifications = sqliteTable('journal_notifications', {
  id: text('id').primaryKey(), moderatorId: text('moderator_id').notNull(),
  message: text('message').notNull(), createdAt: integer('created_at').notNull(), readAt: integer('read_at'),
  clearedAt: integer('cleared_at'),
  positionHistoryHiddenAt: integer('position_history_hidden_at'),
});
export const staffJournalControls = sqliteTable('staff_journal_controls', {
  moderatorId: text('moderator_id').primaryKey().notNull(),
  checksDelta: integer('checks_delta'),
  punishmentsDelta: integer('punishments_delta'),
  hideLogsThrough: integer('hide_logs_through').notNull().default(0),
  activityResetAt: integer('activity_reset_at').notNull().default(0),
});
export const banForms = sqliteTable('ban_forms', {
  id: text('id').primaryKey(), target: text('target').notNull(), reason: text('reason').notNull(),
  duration: text('duration').notNull(), evidence: text('evidence').notNull(),
  creatorKey: text('creator_key').notNull(), creatorName: text('creator_name').notNull(),
  status: text('status').notNull(), createdAt: integer('created_at').notNull(),
  reviewerKey: text('reviewer_key'), reviewerName: text('reviewer_name'), reviewedAt: integer('reviewed_at'),
  decisionReason: text('decision_reason'), executedAt: integer('executed_at'),
});

export const banFormNumbers = sqliteTable('ban_form_numbers', {
  number: integer('number').primaryKey({ autoIncrement: true }),
  formId: text('form_id').notNull(),
}, t => [uniqueIndex('ban_form_numbers_form').on(t.formId)]);

export const manualImages = sqliteTable('manual_images', {
  id: text('id').primaryKey(),
  manualId: text('manual_id'),
  mediaType: text('media_type').notNull(),
  data: text('data').notNull(),
  ownerId: text('owner_id'),
  status: text('status'),
  createdAt: integer('created_at'),
  fileSize: integer('file_size'),
  chunkCount: integer('chunk_count'),
}, t => [index('manual_images_manual').on(t.manualId)]);

export const manualImageChunks = sqliteTable('manual_image_chunks', {
  id: text('id').primaryKey(), imageId: text('image_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(), data: text('data').notNull(),
  byteLength: integer('byte_length').notNull(),
}, t => [uniqueIndex('manual_image_chunks_order').on(t.imageId,t.chunkIndex)]);

export const staffSanctions = sqliteTable('staff_sanctions', {
  id: text('id').primaryKey(),
  moderatorId: text('moderator_id').notNull(),
  moderatorName: text('moderator_name').notNull(),
  type: text('type').notNull(),
  reason: text('reason').notNull(),
  issuedBy: text('issued_by').notNull(),
  issuedByName: text('issued_by_name').notNull(),
  issuedAt: integer('issued_at').notNull(),
  revokedAt: integer('revoked_at'),
  revokedBy: text('revoked_by'),
  revokedByName: text('revoked_by_name'),
}, t => [index('staff_sanctions_moderator').on(t.moderatorId)]);

export const serverChecks = sqliteTable('server_checks', {
id:text('id').primaryKey(),player:text('player').notNull(),playerUuid:text('player_uuid').notNull(),moderator:text('moderator').notNull(),moderatorUuid:text('moderator_uuid').notNull(),reason:text('reason').notNull(),started:integer('started').notNull(),ended:integer('ended').notNull(),result:text('result').notNull(),type:text('type').notNull(),active:integer('active').notNull(),removedBy:text('removed_by').notNull(),
}, t=>[index('server_checks_moderator').on(t.moderator),index('server_checks_player').on(t.player),index('server_checks_started').on(t.started)]);

export const serverPunishments = sqliteTable('server_punishments', {
id:text('id').primaryKey(),player:text('player').notNull(),playerUuid:text('player_uuid').notNull(),moderator:text('moderator').notNull(),moderatorUuid:text('moderator_uuid').notNull(),reason:text('reason').notNull(),started:integer('started').notNull(),ended:integer('ended').notNull(),result:text('result').notNull(),type:text('type').notNull(),active:integer('active').notNull(),removedBy:text('removed_by').notNull(),
}, t=>[index('server_punishments_moderator').on(t.moderator),index('server_punishments_player').on(t.player),index('server_punishments_started').on(t.started)]);

export const serverSync=sqliteTable('server_sync',{kind:text('kind').primaryKey(),updatedAt:integer('updated_at').notNull()});

export const serverRetention=sqliteTable('server_retention',{kind:text('kind').primaryKey(),cutoff:integer('cutoff').notNull()});
