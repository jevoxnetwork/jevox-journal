package ru.jevox.check;

import litebans.api.Entry;
import litebans.api.Events;
import org.bukkit.Bukkit;
import ru.fastfreeze.FastFreeze;

import java.util.Objects;
import java.util.UUID;

final class JournalBans {
    private JournalBans() {}

    static Runnable listen(FastFreeze plugin, CheckBridge bridge) {
        var events = Events.get();
        var listener = new Events.Listener() {
            @Override public void entryAdded(Entry entry) {
                if (!"ban".equals(entry.getType())) return;
                UUID player;
                try {
                    player = UUID.fromString(entry.getUuid());
                } catch (IllegalArgumentException | NullPointerException ignored) {
                    return;
                }
                Bukkit.getScheduler().runTask(plugin, () -> bridge.banned(player,
                        Objects.toString(entry.getExecutorName(), ""), entry.getDateStart()));
            }
        };
        events.register(listener);
        return () -> events.unregister(listener);
    }
}
