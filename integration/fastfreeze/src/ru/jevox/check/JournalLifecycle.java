package ru.jevox.check;

import org.bukkit.command.CommandSender;
import ru.fastfreeze.FastFreeze;
import ru.fastfreeze.FreezeData;

public final class JournalLifecycle {
    private static CheckBridge bridge;

    private JournalLifecycle() {}

    public static void enable(FastFreeze plugin) {
        try {
            var integration = new CheckBridge(plugin);
            if (integration.enable()) bridge = integration;
        } catch (RuntimeException | LinkageError error) {
            plugin.getLogger().warning("Could not start Journal integration: " + error.getClass().getSimpleName());
        }
    }

    public static void disable(FastFreeze plugin) {
        if (bridge == null) return;
        try {
            bridge.disable();
        } finally {
            bridge = null;
        }
    }

    public static void started(FreezeData data) {
        if (bridge != null) bridge.started(data);
    }

    public static void released(FreezeData data, CommandSender sender) {
        if (bridge != null) bridge.finished(data, "Отпущен", sender == null ? "" : sender.getName());
    }

    public static void ended(FreezeData data, String result) {
        if (bridge != null) bridge.finished(data, result, "");
    }
}
