#!/usr/bin/env python3
"""Hardware check: runs each FREE-WILi call the badge uses and prints what the board answers.

  .venv/bin/python probe.py            # then press GREEN / RED / point an IR remote at it for 15 s
"""
import queue
import time

import onewili

dev = onewili.connect()
print("connected:", [d.serial for d in onewili.find_devices()])


def show(label, result):
    print(f"{label:<28} → {result!r}")


show("gui.show_text", dev.gui.show_text("MUTUAL test\npeople find people"))
time.sleep(1)
for i in range(7):
    r = dev.gui.set_led_color(i, 150, 110, 255, 0, 2)
show("gui.set_led_color x7 (pulse)", r)
show("io.audio.speak", dev.io.audio.speak("Hello from Mutual"))
show("gui.stream_io(100)", dev.gui.stream_io(100))
show("wireless.ir.enable_ir_stream", dev.wireless.ir.enable_ir_stream(1))
show("wireless.ir.send_ir_data", dev.wireless.ir.send_ir_data(12345))

print("\nPress GREEN, RED, other buttons (or aim an IR remote) for 15 s. Events:")
end = time.monotonic() + 15
while time.monotonic() < end:
    try:
        f = dev._transport.events.get(timeout=0.5)
        print("  event:", f.path, "|", f.response)
    except queue.Empty:
        pass
    try:
        while True:
            print("  line :", dev._transport.lines.get_nowait())
    except queue.Empty:
        pass
show("gui.stream_io(0) stop", dev.gui.stream_io(0))
dev.close()
print("done")
