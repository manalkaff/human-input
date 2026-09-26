# Generates index.html: scene slots, the music bed and every SFX cue.
scenes = [
    ("s01-ask", 0.0, 4.7), ("s02-paste", 4.7, 3.8), ("s03-rotate", 8.5, 3.4),
    ("s04-detour", 11.9, 3.75), ("s05-better", 15.65, 4.07), ("s06-reveal", 19.72, 4.53),
    ("s07-form", 24.25, 6.8), ("s08-placeholder", 31.05, 4.53), ("s09-destinations", 35.58, 6.8),
    ("s10-hooks", 42.38, 6.8), ("s11-tools", 49.18, 5.27), ("s12-cta", 54.45, 8.55),
]
# (time, sfx, volume, duration or None)
cues = [
    # s01 — the ask
    (0.45, "typing-long", 0.35, 1.15), (1.85, "tick", 0.3, None), (2.17, "tick", 0.3, None),
    (2.65, "pop-b", 0.35, None), (3.1, "whoosh-soft", 0.3, None),
    # s02 — the paste
    (4.9, "click", 0.55, None), (5.3, "switch", 0.45, None), (5.32, "hit", 0.6, None), (5.32, "glitch-a", 0.5, None),
    (5.95, "error-a", 0.45, None), (6.45, "error-b", 0.5, None), (6.95, "error-c", 0.5, None),
    (8.0, "glitch-b", 0.6, None), (8.12, "glitch-a", 0.6, None), (8.26, "glitch-b", 0.6, None), (8.3, "whoosh-b", 0.45, None),
    # s03 — rotate it. again.
    (8.55, "typing-short", 0.3, 0.8), (9.9, "hit", 0.85, None), (10.6, "boom", 0.8, None), (10.6, "low-impact", 0.5, None),
    # s04 — the detour
    (11.98, "pop-a", 0.45, None), (12.28, "drop", 0.45, None), (12.58, "pop-a", 0.45, None), (12.88, "drop", 0.45, None),
    (13.18, "pop-a", 0.45, None), (13.6, "hit", 0.45, None), (14.07, "hit", 0.45, None), (14.54, "hit", 0.45, None),
    (15.01, "boom", 0.6, None),
    # s05 — there's a better way
    (15.8, "whoosh-soft", 0.3, None), (16.32, "riser", 0.7, None), (18.12, "reverse", 0.6, None),
    # s06 — the drop
    (19.72, "subboom", 1.0, None), (19.72, "boom", 0.7, None), (20.27, "whoosh-combo", 0.4, None),
    (21.98, "tick", 0.35, None), (22.36, "tick", 0.35, None), (22.74, "tick", 0.35, None), (23.85, "whoosh-a", 0.5, None),
    # s07 — the form
    (24.25, "whoosh-soft", 0.4, None), (24.63, "pop-b", 0.4, None), (25.0, "whoosh-soft", 0.35, None),
    (25.9, "typing-long", 0.35, 0.8), (26.95, "typing-short", 0.35, 0.75), (27.97, "click", 0.6, None),
    (28.4, "confirm", 0.6, None), (30.6, "whoosh-b", 0.5, None),
    # s08 — placeholder
    (31.45, "whoosh-soft", 0.35, None), (32.05, "whoosh-a", 0.5, None), (32.6, "hit", 0.7, None), (32.6, "glitch-a", 0.4, None),
    (32.65, "whoosh-c", 0.4, None), (33.35, "pop-a", 0.35, None),
    # s09 — destinations
    (35.96, "pop-b", 0.45, None), (36.33, "switch", 0.3, None), (36.71, "drop", 0.4, None), (37.09, "drop", 0.4, None),
    (37.47, "drop", 0.4, None), (37.84, "drop", 0.4, None), (39.0, "bong", 0.3, None), (39.755, "bong", 0.3, None),
    (40.51, "bong", 0.3, None), (41.265, "bong", 0.3, None), (41.88, "whoosh-b", 0.45, None),
    # s10 — hooks
    (42.83, "typing-long", 0.3, 0.85), (44.28, "glitch-a", 0.45, None), (44.4, "glitch-b", 0.45, None), (44.83, "confirm-b", 0.4, None),
    (45.58, "typing-short", 0.3, 0.4), (46.48, "whoosh-soft", 0.45, None), (46.68, "glitch-b", 0.4, None), (47.1, "confirm-b", 0.4, None),
    (48.78, "whoosh-a", 0.45, None),
    # s11 — tools
    (49.56, "drop", 0.35, None), (49.935, "drop", 0.35, None), (50.31, "drop", 0.35, None), (50.69, "drop", 0.35, None),
    (51.45, "pop-a", 0.3, None), (54.15, "whoosh-soft", 0.4, None),
    # s12 — CTA
    (54.45, "tick", 0.3, None), (54.83, "tick", 0.3, None), (55.2, "tick", 0.3, None), (55.58, "tick", 0.3, None), (55.96, "tick", 0.3, None),
    (56.55, "whoosh-b", 0.4, None), (57.25, "typing-long", 0.3, 1.2), (58.65, "typing-long", 0.3, 1.05),
    (60.0, "pop-b", 0.45, None), (60.02, "subboom", 0.35, None),
]
slots = "\n".join(
    f'      <div id="el-{sid[:3]}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" '
    f'data-start="{st}" data-duration="{du}" data-track-index="1" data-width="1920" data-height="1080"></div>'
    for sid, st, du in scenes)
sfx = []
for i, (t, name, vol, dur) in enumerate(cues):
    d = f' data-duration="{dur}" data-fade-out="0.08"' if dur else ""
    sfx.append(f'      <audio id="sfx-{i:02d}-{name}" src="assets/audio/sfx/{name}.mp3" data-start="{t}"{d} data-track-index="{11 + i}" data-volume="{vol}"></audio>')
sfx = "\n".join(sfx)
auto = '{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":0.5,"v":2.4},{"t":17.95,"v":2.4},{"t":18.2,"v":0.9},{"t":57.3,"v":0.9},{"t":57.9,"v":1.9},{"t":60.6,"v":1.9},{"t":63,"v":0}]}]}'
html = open("tools/index.template.html").read().replace("{{SLOTS}}", slots).replace("{{SFX}}", sfx).replace("{{AUTO}}", auto)
open("index.html", "w").write(html)
print(len(scenes), "scenes,", len(cues), "sfx cues")
