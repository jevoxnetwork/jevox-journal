import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

public final class WireFastFreeze {
    public static void main(String[] args) throws Exception {
        Path file = Path.of(args[0]);
        ClassReader reader = new ClassReader(Files.readAllBytes(file));
        ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
        reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                MethodVisitor method = super.visitMethod(access, name, descriptor, signature, exceptions);
                if (!descriptor.equals("()V") || (!name.equals("onEnable") && !name.equals("onDisable"))) return method;
                return new MethodVisitor(Opcodes.ASM9, method) {
                    private void hook(String action) {
                        super.visitVarInsn(Opcodes.ALOAD, 0);
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, "ru/jevox/check/JournalLifecycle", action, "(Lru/fastfreeze/FastFreeze;)V", false);
                    }

                    @Override public void visitCode() {
                        super.visitCode();
                        if (name.equals("onDisable")) hook("disable");
                    }

                    @Override public void visitInsn(int opcode) {
                        if (name.equals("onEnable") && opcode == Opcodes.RETURN) hook("enable");
                        super.visitInsn(opcode);
                    }
                };
            }
        }, 0);
        Files.write(file, writer.toByteArray());
    }
}
