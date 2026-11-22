package ru.jevox.check;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.YamlConfiguration;
import ru.fastfreeze.FastFreeze;
import ru.fastfreeze.FreezeData;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

final class CheckBridge {
    private record Check(String id, FreezeData data, long started) {}
    private record Finished(Check check, long ended) {}

    private final FastFreeze plugin;
    private final Gson gson = new Gson();
    private final ArrayDeque<JsonObject> outbox = new ArrayDeque<>();
    private final AtomicBoolean exchanging = new AtomicBoolean();
    private final Map<UUID, Check> active = new HashMap<>();
    private final Map<UUID, Finished> recent = new HashMap<>();
    private final Path outboxFile;
    private JournalTransport transport;
    private Runnable stopBanListener = () -> {};
    private boolean dirty;
    private long lastWarning;

    CheckBridge(FastFreeze plugin) {
        this.plugin = plugin;
        outboxFile = plugin.getDataFolder().toPath().resolve("journal-outbox.json");
    }

    boolean enable() {
        var file = plugin.getDataFolder().toPath().resolve("journal.yml").toFile();
        if (!file.isFile()) plugin.saveResource("journal.yml", false);
        var config = YamlConfiguration.loadConfiguration(file);
        String token = config.getString("bridge-token", "").trim();
        URI site = URI.create(config.getString("journal-url", ""));
        if (token.length() < 40 || !"https".equals(site.getScheme()) || site.getHost() == null
                || site.getUserInfo() != null || site.getFragment() != null || site.getQuery() != null) {
            plugin.getLogger().warning("Set journal-url and bridge-token in FastFreeze/journal.yml.");
            return false;
        }

        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8));
        String proxy = config.getString("proxy.host", "").trim();
        int port = config.getInt("proxy.port", 0);
        if (!proxy.isEmpty()) {
            if (port < 1 || port > 65535) {
                plugin.getLogger().warning("Set a valid proxy.port in FastFreeze/journal.yml.");
                return false;
            }
            client.proxy(ProxySelector.of(InetSocketAddress.createUnresolved(proxy, port)));
        }
        URI endpoint = site.resolve("/api/check-bridge");
        URI fallback = "jevoxjournal.pages.dev".equalsIgnoreCase(site.getHost())
                ? URI.create("https://jevox-check-transport.1pirs.workers.dev/api/check-bridge") : null;
        transport = new JournalTransport(client.build(), endpoint, fallback, token);
        restoreOutbox();
        if (Bukkit.getPluginManager().isPluginEnabled("LiteBans")) {
            try {
                Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, new JournalPunishments(plugin, this), 60, 200);
                stopBanListener = JournalBans.listen(plugin, this);
            } catch (RuntimeException | LinkageError error) {
                plugin.getLogger().warning("LiteBans hook unavailable; check history remains enabled.");
            }
        }
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, this::exchange, 5, 40);
        plugin.getLogger().info("Journal history enabled for " + endpoint.getHost());
        return true;
    }

    void disable() {
        try {
            stopBanListener.run();
        } catch (RuntimeException | LinkageError error) {
            plugin.getLogger().warning("Could not unregister Journal LiteBans listener.");
        }
        for (Check check : List.copyOf(active.values())) finished(check.data(), "Сервер остановлен", "");
        persistOutbox();
    }

    void started(FreezeData data) {
        UUID player = data.getSuspect();
        var check = new Check("fastfreeze-" + UUID.randomUUID(), data, System.currentTimeMillis());
        recent.remove(player);
        active.put(player, check);
        report(check, 0, "На проверке", "");
    }

    void finished(FreezeData data, String result, String actor) {
        UUID player = data.getSuspect();
        Check check = active.get(player);
        if (check == null || check.data() != data) return;
        active.remove(player);
        long ended = System.currentTimeMillis();
        report(check, ended, result, actor);
        if (result.equals("Сервер остановлен")) return;
        var finished = new Finished(check, ended);
        recent.put(player, finished);
        Bukkit.getScheduler().runTaskLater(plugin, () -> recent.remove(player, finished), 100);
    }

    void banned(UUID player, String moderator, long started) {
        Check ongoing = active.get(player);
        if (ongoing != null && started < ongoing.started()) return;
        Finished closed = recent.get(player);
        Check check = ongoing != null ? ongoing : closed == null ? null : closed.check();
        if (check == null || started < check.started() || (ongoing == null && started > closed.ended() + 5000)) return;

        if (ongoing != null) {
            finished(ongoing.data(), "Забанен", moderator);
        } else {
            report(check, closed.ended(), "Забанен", moderator);
        }
    }

    private void report(Check check, long ended, String result, String actor) {
        FreezeData data = check.data();
        enqueue("checks", object("id", check.id(), "player", data.getSuspectName(),
                "player_uuid", data.getSuspect().toString(), "moderator", data.getCheckerName(),
                "moderator_uuid", Objects.toString(data.getChecker(), ""), "reason", "",
                "started", check.started(), "ended", ended, "result", result,
                "type", "check", "active", ended == 0 ? 1 : 0, "removed_by", actor));
    }

    private synchronized void enqueue(String kind, JsonObject record) {
        outbox.add(object("op", "sync", "kind", kind, "records", List.of(record)));
        dirty = true;
    }

    void syncPunishments(List<JsonObject> records) throws IOException, InterruptedException {
        post(object("op", "sync", "kind", "punishments", "records", records));
    }

    private void post(JsonObject packet) throws IOException, InterruptedException {
        var response = transport.post(packet.toString());
        if (response.statusCode() != 200) throw new IOException("HTTP " + response.statusCode());
    }

    private void exchange() {
        if (!exchanging.compareAndSet(false, true)) return;
        try {
            persistOutbox();
            for (int sent = 0; sent < 48; sent++) {
                JsonObject packet;
                synchronized (this) {
                    packet = outbox.peek();
                }
                if (packet == null) return;
                post(packet);
                synchronized (this) {
                    outbox.removeFirst();
                    dirty = true;
                }
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } catch (IOException error) {
            long now = System.currentTimeMillis();
            if (now - lastWarning >= 60000) {
                lastWarning = now;
                plugin.getLogger().warning("Journal connection via " + transport.endpoint().getHost() + ": "
                        + error.getClass().getSimpleName());
            }
        } finally {
            persistOutbox();
            exchanging.set(false);
        }
    }

    private synchronized void persistOutbox() {
        if (!dirty) return;
        try {
            if (outbox.isEmpty()) {
                Files.deleteIfExists(outboxFile);
            } else {
                Path temp = outboxFile.resolveSibling("journal-outbox.tmp");
                Files.writeString(temp, gson.toJson(outbox), StandardCharsets.UTF_8);
                Files.move(temp, outboxFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            }
            dirty = false;
        } catch (IOException error) {
            plugin.getLogger().warning("Could not save pending Journal check events.");
        }
    }

    private void restoreOutbox() {
        if (!Files.isRegularFile(outboxFile)) return;
        try {
            var saved = new ArrayList<JsonObject>();
            for (var item : JsonParser.parseString(Files.readString(outboxFile)).getAsJsonArray()) {
                var packet = item.getAsJsonObject();
                if (packet.has("op") && packet.get("op").getAsString().equals("sync")) saved.add(packet);
            }
            outbox.addAll(saved);
            dirty = true;
        } catch (IOException | RuntimeException error) {
            plugin.getLogger().warning("Could not restore pending Journal check events.");
        }
    }

    private JsonObject object(Object... fields) {
        var result = new JsonObject();
        for (int i = 0; i < fields.length; i += 2) {
            result.add((String) fields[i], gson.toJsonTree(fields[i + 1]));
        }
        return result;
    }
}
