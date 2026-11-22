package ru.jevox.check;

import com.google.gson.JsonObject;
import litebans.api.Database;
import ru.fastfreeze.FastFreeze;

import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

final class JournalPunishments implements Runnable {
    private static final int PAGE_SIZE = 50;
    private static final long RECONCILE_DELAY = 15 * 60 * 1000L;

    private enum Type {
        BAN("ban", "bans"), MUTE("mute", "mutes"), WARN("warn", "warnings"), KICK("kick", "kicks");

        final String name;
        final String table;

        Type(String name, String table) {
            this.name = name;
            this.table = table;
        }
    }

    private enum Order { NEW, HISTORY }

    private record Punishment(long id, String uuid, String moderator, String moderatorUuid, String reason,
                              long issued, long expires, boolean active, String removedBy) {}

    private static final class Cursor {
        long latest = -1;
        long before = Long.MAX_VALUE;
        long scanAfter;
        long lastWarning;
    }

    private final FastFreeze plugin;
    private final CheckBridge bridge;
    private final Map<Type, Cursor> cursors = new java.util.EnumMap<>(Type.class);
    private final AtomicBoolean running = new AtomicBoolean();
    private boolean synced;
    private long lastWarning;

    JournalPunishments(FastFreeze plugin, CheckBridge bridge) {
        this.plugin = plugin;
        this.bridge = bridge;
        for (Type type : Type.values()) cursors.put(type, new Cursor());
    }

    @Override
    public void run() {
        if (!running.compareAndSet(false, true)) return;
        try {
            Database database = Database.get();
            for (Type type : Type.values()) {
                Cursor cursor = cursors.get(type);
                try {
                    sync(database, type, cursor);
                } catch (SQLException error) {
                    long now = System.currentTimeMillis();
                    if (now - cursor.lastWarning >= 60000) {
                        cursor.lastWarning = now;
                        plugin.getLogger().warning("LiteBans read failed for " + type.name + "; will retry.");
                    }
                }
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } catch (IOException | RuntimeException | LinkageError error) {
            long now = System.currentTimeMillis();
            if (now - lastWarning >= 60000) {
                lastWarning = now;
                plugin.getLogger().warning("LiteBans → Journal sync failed: " + error.getClass().getSimpleName()
                        + (error instanceof IOException && Objects.toString(error.getMessage(), "").matches("HTTP \\d{3}")
                        ? " " + error.getMessage() : "") + "; will retry.");
            }
        } finally {
            running.set(false);
        }
    }

    private void sync(Database database, Type type, Cursor cursor) throws SQLException, IOException, InterruptedException {
        if (cursor.latest >= 0) {
            List<Punishment> fresh = read(database, type, Order.NEW, cursor.latest);
            if (!fresh.isEmpty()) {
                send(database, type, fresh);
                cursor.latest = fresh.getLast().id();
            }
        }

        long now = System.currentTimeMillis();
        if (now < cursor.scanAfter) return;
        List<Punishment> history = read(database, type, Order.HISTORY, cursor.before);
        if (!history.isEmpty() || !synced) send(database, type, history);

        if (cursor.latest < 0) cursor.latest = history.isEmpty() ? 0 : history.getFirst().id();
        if (history.size() == PAGE_SIZE) {
            cursor.before = history.getLast().id();
        } else {
            cursor.before = Long.MAX_VALUE;
            cursor.scanAfter = now + RECONCILE_DELAY;
        }
    }

    private List<Punishment> read(Database database, Type type, Order order, long cursor) throws SQLException {
        String page = order == Order.NEW ? "id>? ORDER BY id ASC" : "id<? ORDER BY id DESC";
        var result = new ArrayList<Punishment>();
        // LiteBans substitutes the table prefix and supplies its existing connection.
        try (var statement = database.prepareStatement("SELECT * FROM {" + type.table + "} WHERE " + page + " LIMIT " + PAGE_SIZE)) {
            statement.setLong(1, cursor);
            try (ResultSet rows = statement.executeQuery()) {
                var columns = rows.getMetaData();
                boolean hasExpiry = false, hasActive = false, hasRemoval = false;
                for (int i = 1; i <= columns.getColumnCount(); i++) {
                    String name = columns.getColumnLabel(i);
                    hasExpiry |= "until".equalsIgnoreCase(name);
                    hasActive |= "active".equalsIgnoreCase(name);
                    hasRemoval |= "removed_by_name".equalsIgnoreCase(name);
                }
                long now = System.currentTimeMillis();
                while (rows.next()) {
                    long expires = hasExpiry ? rows.getLong("until") : 0;
                    boolean active = type != Type.KICK && hasActive && rows.getBoolean("active")
                            && (expires <= 0 || expires > now);
                    result.add(new Punishment(rows.getLong("id"), rows.getString("uuid"),
                            rows.getString("banned_by_name"), rows.getString("banned_by_uuid"), rows.getString("reason"),
                            Math.max(0, rows.getLong("time")), Math.max(0, expires),
                            active, hasRemoval ? rows.getString("removed_by_name") : ""));
                }
            }
        }
        return result;
    }

    private void send(Database database, Type type, List<Punishment> punishments) throws IOException, InterruptedException {
        // Name lookup can use another SQL connection. The page's result set is already closed.
        var names = new HashMap<String, String>();
        var records = new ArrayList<JsonObject>();
        int length = 0;
        for (Punishment item : punishments) {
            String uuid = text(item.uuid(), 36);
            String player = names.computeIfAbsent(uuid, key -> playerName(database, key));
            JsonObject record = new JsonObject();
            record.addProperty("id", type.name + "-" + item.id());
            record.addProperty("type", type.name);
            record.addProperty("player", player);
            record.addProperty("player_uuid", uuid);
            record.addProperty("moderator", text(item.moderator(), 100));
            record.addProperty("moderator_uuid", text(item.moderatorUuid(), 100));
            record.addProperty("reason", text(item.reason(), 5000));
            record.addProperty("started", item.issued());
            record.addProperty("ended", item.expires());
            record.addProperty("active", item.active() ? 1 : 0);
            record.addProperty("removed_by", text(item.removedBy(), 100));
            int size = record.toString().length() + 1;
            if (!records.isEmpty() && length + size > 48000) {
                bridge.syncPunishments(records);
                records.clear();
                length = 0;
            }
            records.add(record);
            length += size;
        }
        bridge.syncPunishments(records);
        if (!synced) plugin.getLogger().info("LiteBans punishment sync connected to Jevox Journal.");
        synced = true;
    }

    private String playerName(Database database, String uuid) {
        if (uuid.isBlank()) return "Неизвестный игрок";
        try {
            String name = text(database.getPlayerName(UUID.fromString(uuid)), 100);
            return name.isBlank() ? uuid : name;
        } catch (IllegalArgumentException error) {
            return uuid;
        }
    }

    private static String text(String value, int limit) {
        String text = Objects.toString(value, "").strip();
        return text.length() <= limit ? text : text.substring(0, limit);
    }
}
