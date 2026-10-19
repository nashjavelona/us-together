import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const coupleSpaces = sqliteTable("couple_spaces", {
  id: text("id").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
  zone: text("zone").notNull(),
  writeId: text("write_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const coupleMembers = sqliteTable("couple_members", {
  spaceId: text("space_id").notNull().references(() => coupleSpaces.id, { onDelete: "cascade" }),
  role: integer("role").notNull(),
  recoveryHash: text("recovery_hash").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [primaryKey({ columns: [table.spaceId, table.role] })]);

export const coupleDevices = sqliteTable("couple_devices", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => coupleSpaces.id, { onDelete: "cascade" }),
  role: integer("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeen: integer("last_seen").notNull(),
  revokedAt: integer("revoked_at"),
}, table => [uniqueIndex("couple_devices_token_unique").on(table.tokenHash), index("couple_devices_member_idx").on(table.spaceId, table.role)]);

export const coupleInvites = sqliteTable("couple_invites", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => coupleSpaces.id, { onDelete: "cascade" }),
  role: integer("role").notNull(),
  inviteHash: text("invite_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  revokedAt: integer("revoked_at"),
  claimedBy: text("claimed_by"),
}, table => [uniqueIndex("couple_invites_hash_unique").on(table.inviteHash), index("couple_invites_space_idx").on(table.spaceId)]);

export const coupleOperations = sqliteTable("couple_operations", {
  spaceId: text("space_id").notNull().references(() => coupleSpaces.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  mutationId: text("mutation_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [primaryKey({ columns: [table.spaceId, table.deviceId, table.mutationId] }), index("couple_operations_age_idx").on(table.spaceId, table.createdAt)]);

export const coupleSnapshots = sqliteTable("couple_snapshots", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => coupleSpaces.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  stateJson: text("state_json").notNull(),
  reason: text("reason").notNull(),
  taskCount: integer("task_count").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("couple_snapshots_space_idx").on(table.spaceId, table.createdAt)]);

export const coupleRateLimits = sqliteTable("couple_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  hits: integer("hits").notNull(),
});
