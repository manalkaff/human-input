# human-input launch video

A 63-second, music-driven launch video for the `human-input` Claude Code plugin,
built with [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP, rendered to MP4).

**Final cut:** `renders/human-input-launch.mp4` (1920×1080, 30 fps, AAC, mastered to -14 LUFS)

## Story

| Time | Scene | Beat |
| --- | --- | --- |
| 0:00 | `s01-ask` | Claude hits a step that needs a Stripe secret key |
| 0:04.7 | `s02-paste` | The key gets pasted into chat: sent to the model, saved in the transcript, written to logs |
| 0:08.5 | `s03-rotate` | "Rotate it. Again." |
| 0:11.9 | `s04-detour` | The "safe" way: leave the session, edit files by hand, come back, explain |
| 0:15.65 | `s05-better` | "There's a better way." Riser into silence |
| 0:19.72 | `s06-reveal` | Music drops: logo reveal, "Claude asks. You type. Claude never sees it." |
| 0:24.25 | `s07-form` | `request_input` shows a form in the session |
| 0:31.05 | `s08-placeholder` | The value stops at the plugin; Claude gets `{{secret:…}}` |
| 0:35.58 | `s09-destinations` | .env file, any CLI, other MCP tools, any file |
| 0:42.38 | `s10-hooks` | PreToolUse swaps placeholders in; PostToolUse scrubs output |
| 0:49.18 | `s11-tools` | The four tools |
| 0:54.45 | `s12-cta` | Install commands and repo link |

Scene cuts after the drop sit on the music's beat grid (159 BPM, drop at 19.72 s).

## Work on it

```
npx hyperframes preview          # Studio preview
npx hyperframes check            # lint + runtime + layout + contrast
python3 tools/build_index.py     # regenerate index.html (scene slots + SFX cue sheet)
npx hyperframes render --quality high --output renders/video-raw.mp4
ffmpeg -i renders/video-raw.mp4 -af "loudnorm=I=-14:TP=-1.0:LRA=7" -c:v copy -c:a aac -b:a 256k renders/human-input-launch.mp4
```

Edit `tools/index.template.html` or the cue list in `tools/build_index.py`, not
`index.html` directly. On machines without the bundled Chrome, point
`HYPERFRAMES_BROWSER_PATH` at a headless Chromium.

## Credits and licenses

- **Music:** "Elevate Inspirate" from [FreePD](https://freepd.com) (public domain / CC0), via the
  [SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music) collection.
- **UI sounds** (clicks, errors, glitches, confirmations, pops, drops): [Kenney](https://kenney.nl)
  Interface Sounds, UI Audio, Digital Audio and Sci-fi Sounds (CC0), via
  [open-game-sfx-index](https://github.com/Mcamento8/open-game-sfx-index).
- **Whooshes and boom:** Ben Burnes' "Organic Wooshes" micro pack and 2HTC samples (CC0), via
  [lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds).
- **Riser, sub boom, hit, reverse swell, keyboard typing:** synthesized for this video (typing is
  sequenced from the Kenney clicks).
- **Fonts:** Archivo and IBM Plex Mono (SIL OFL, licenses in `assets/fonts/`).
- **GSAP** 3.14 (bundled in `assets/vendor`).
