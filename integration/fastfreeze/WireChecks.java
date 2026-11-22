import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

public final class WireChecks {
    private static final String MANAGER = "ru/fastfreeze/FreezeManager";
    private static final String DATA = "ru/fastfreeze/FreezeData";
    private static final String HOOK = "ru/jevox/check/JournalLifecycle";
    private static final String CHECK = "L" + DATA + ";";

    public static void main(String[] args) throws Exception {
        Path file = Path.of(args[0]).resolve(MANAGER + ".class");
        ClassReader input = new ClassReader(Files.readAllBytes(file));
        ClassWriter output = new ClassWriter(input, ClassWriter.COMPUTE_MAXS);
        Set<String> wired = new HashSet<>();
        input.accept(new ClassVisitor(Opcodes.ASM9, output) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                MethodVisitor method = super.visitMethod(access, name, descriptor, signature, exceptions);
                return new MethodVisitor(Opcodes.ASM9, method) {
                    private void hook(String action, String arguments) {
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, HOOK, action, "(" + arguments + ")V", false);
                        if (!wired.add(name)) throw new IllegalStateException("Duplicate FastFreeze hook: " + name);
                    }

                    @Override
                    public void visitMethodInsn(int opcode, String owner, String called, String desc, boolean itf) {
                        if (name.equals("performFreeze") && owner.equals(DATA) && called.equals("start") && desc.equals("()V")) {
                            super.visitInsn(Opcodes.DUP);
                            super.visitMethodInsn(opcode, owner, called, desc, itf);
                            hook("started", CHECK);
                            return;
                        }
                        if (owner.equals(MANAGER) && called.equals("removeData") && desc.equals("(" + CHECK + ")V")) {
                            switch (name) {
                                case "finishCheck" -> {
                                    super.visitInsn(Opcodes.DUP);
                                    super.visitVarInsn(Opcodes.ALOAD, 2);
                                    hook("released", CHECK + "Lorg/bukkit/command/CommandSender;");
                                }
                                case "onSuspectQuit", "onCheckerQuit" -> {
                                    super.visitInsn(Opcodes.DUP);
                                    super.visitLdcInsn(name.equals("onSuspectQuit") ? "Игрок вышел" : "Модератор вышел");
                                    hook("ended", CHECK + "Ljava/lang/String;");
                                }
                            }
                        }
                        super.visitMethodInsn(opcode, owner, called, desc, itf);
                    }
                };
            }
        }, 0);
        if (!wired.equals(Set.of("performFreeze", "finishCheck", "onSuspectQuit", "onCheckerQuit"))) {
            throw new IllegalStateException("Unsupported FastFreeze jar. Patched methods: " + wired);
        }
        Files.write(file, output.toByteArray());
    }
}
