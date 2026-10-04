"""Render actual browser captures; use --main for the main-software demonstration."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'video-deps'))
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

MAIN = '--main' in sys.argv
SOURCE = ROOT / 'videos' / ('main-software-frames' if MAIN else 'simulation-frames')
RENDERED = SOURCE / 'rendered'
RENDERED.mkdir(exist_ok=True)
OUT = ROOT / 'videos' / ('Advanced-AI-Lab-Cloth-Scanner-Main-Software.mp4' if MAIN else 'Advanced-AI-Lab-Cloth-Scanner-Simulation.mp4')
PREVIEW = ROOT / 'videos' / ('main-software-preview.jpg' if MAIN else 'simulation-preview.jpg')
W, H = 1920, 1080
FONT_DIR = Path('C:/Windows/Fonts')
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)

COLORS = {'Good': '#62c48a', 'Defected': '#ef7774', 'Repairable': '#ebc36d', 'Standby': '#b7c5bb'}
LABELS = {'Good': 'Code 2  /  GREEN', 'Defected': 'Code 1  /  RED', 'Repairable': 'Code 3  /  YELLOW', 'Standby': 'ALL LIGHTS OFF'}

def compose(source, chapter, headline, lines, signal=None):
    canvas = Image.new('RGB', (W, H), '#182b23')
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((44, 30, 116, 102), 18, fill='#dcebdc')
    d.text((55, 47), 'AAI', font=font(25, True), fill='#203c2d')
    d.text((140, 31), 'Advanced AI Lab - Cloth Scanner', font=font(36, True), fill='#f3f6ee')
    d.text((142, 81), 'MAIN SOFTWARE DEMONSTRATION  /  MOCK ESP32' if MAIN else 'SIMULATION DEMONSTRATION', font=font(18), fill='#b0c5b4')
    d.line((44, 127, 1876, 127), fill='#3b5145', width=2)
    capture = Image.open(SOURCE / source).convert('RGB')
    capture.thumbnail((1090, 874), Image.Resampling.LANCZOS)
    x = 44 + (1090 - capture.width) // 2
    y = 149 + (874 - capture.height) // 2
    canvas.paste(capture, (x, y))
    d = ImageDraw.Draw(canvas)
    d.text((1192, 165), chapter.upper(), font=font(22, True), fill='#a9c2ac')
    for index, line in enumerate(headline.split('\n')):
        d.text((1192, 218 + index * 59), line, font=font(42, True), fill='#f3f6ee')
    y_text = 365
    for line in lines:
        d.text((1192, y_text), line, font=font(24), fill='#cad7cc')
        y_text += 43
    if signal:
        color = COLORS[signal]
        d.rounded_rectangle((1192, 555, 1860, 668), 16, fill='#284234', outline=color, width=2)
        d.ellipse((1217, 593, 1250, 626), fill=color)
        d.text((1270, 577), signal.upper(), font=font(28, True), fill=color)
        d.text((1270, 617), LABELS[signal], font=font(20), fill='#e2ece1')
    d.text((1192, 745), 'STATUS MAPPING', font=font(19, True), fill='#a9c2ac')
    for index, (name, label) in enumerate([('Defected', '1   Defected   /   Red'), ('Good', '2   Good   /   Green'), ('Repairable', '3   Repairable   /   Yellow')]):
        line_y = 792 + index * 49
        d.ellipse((1195, line_y + 5, 1212, line_y + 22), fill=COLORS[name])
        d.text((1230, line_y), label, font=font(24), fill='#dae5db')
    footer = 'Real controller API  |  Mock ESP32 + sample AI predictions  |  Isolated demo data  |  No physical USB upload' if MAIN else 'Actual simulator interface  |  Virtual ESP32 and tower light  |  No physical hardware connected'
    d.text((44, 1036), footer, font=font(18), fill='#afc3b3')
    return canvas

segments = []
def add(source, duration, chapter, headline, lines, signal=None):
    frame = compose(source, chapter, headline, lines, signal)
    name = f'frame-{len(segments):03d}.jpg'
    frame.save(RENDERED / name, quality=95, subsampling=0)
    segments.append((name, duration))
    return frame

if MAIN:
    add('operator-access.jpg', 3, '01 / Operator access', 'Open the\ncontrol dashboard', ['Sign in with the operator key.', 'Device and AI keys are separate.', 'Credentials are not shown in this video.'])
    add('dashboard.jpg', 4, '02 / Live controller', 'Connect once.\nStart the line.', ['The mock ESP32 is reporting.', 'The example AI sender is connected.', 'Select Start line to arm processing.'])
else:
    add('intro.jpg', 3, '01 / Simulator', 'From JSON\nto a clear signal', ['Four sample cloth results.', 'One light active at a time.', 'Five seconds per inspection.'])
    add('json-input.jpg', 4, '02 / JSON input', 'Load the\ninspection batch', ['Sample results use status codes.', 'The simulator validates the JSON.', 'Select Load results to begin.'])
frames = json.loads((SOURCE / 'capture.json').read_text())
repair_frames = [frame['file'] for frame in frames if frame['signal'] == 'Repairable']
poster_source = repair_frames[len(repair_frames) // 2] if repair_frames else frames[0]['file']
for frame in frames:
    signal = frame['signal']
    if MAIN and signal == 'Standby':
        headline = 'Line armed.\nAwaiting AI input.'
        lines = ['Results arrive automatically by HTTP.', 'Between cloths, all outputs turn off.', 'The line stays ready for the next cloth.']
    elif MAIN:
        headline = 'AI result received.\nOutput reported.'
        lines = ['The AI sends one result per cloth.', 'The mock ESP32 fetches and reports it.', 'The live dashboard updates automatically.']
    elif signal == 'Standby':
        headline = 'Batch complete.\nAll outputs off.'
        lines = ['Every queued cloth was processed.', 'The virtual tower returns to standby.']
    else:
        headline = 'Cloth classified.\nSignal applied.'
        lines = ['Playback: green, red, yellow, green.', 'The cloth ID and code update live.', 'Only the matching light is active.']
    rendered = add(frame['file'], .5, '03 / Automatic AI delivery' if MAIN else '03 / Live playback', headline, lines, signal)
    if frame['file'] == poster_source:
        rendered.save(PREVIEW, quality=95)
if MAIN:
    add('paused-controls.jpg', 4, '04 / Operator controls', 'Pause the line.\nRelease the outputs.', ['Pause stops active processing.', 'Waiting results remain queued.', 'Duration is configurable per inspection.'])
    add('history.jpg', 4, '05 / Persistent history', 'Four cloths.\nFour completions.', ['Status, output and timing are recorded.', 'The activity log includes device reports.', 'Export is available from the dashboard.'])
    add('device-settings.jpg', 4, '06 / ESP32 configuration', 'Enter Wi-Fi\nand output settings.', ['Example settings are used here.', 'Choose GPIO pins and relay polarity.', 'The device key is inserted automatically.'])
    add('building.jpg', 3, '07 / Firmware compilation', 'Build the\nESP32 firmware.', ['This demonstration ran a real build.', 'Compiler progress appears in the log.', 'The table line stays paused.'])
    add('firmware-ready.jpg', 6, '08 / USB installation', 'Build successful.\nReady for a board.', ['Refresh ports and select the ESP32.', 'Confirm replacement, then Upload.', 'No board connected: no USB flash done.'])
    add('ai-integration.jpg', 5, '09 / Production integration', 'Connect your AI\nresult sender.', ['Your AI calls the result API per cloth.', 'There is no manual JSON upload here.', 'The browser can stay closed in operation.'])
else:
    add('completed-history.jpg', 4, '04 / Inspection history', 'Four results.\nFour completions.', ['Each cloth has a recorded result.', 'Classification and signal stay visible.', 'The activity log shows the sequence.'])

playlist = RENDERED / 'sequence.txt'
playlist.write_text(''.join(f"file '{name}'\nduration {duration:.6f}\n" for name, duration in segments) + f"file '{segments[-1][0]}'\n", encoding='utf-8')
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', str(playlist), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(OUT)], check=True)
# Decode the delivered file end-to-end to check the exported video is valid.
subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(OUT), '-f', 'null', '-'], check=True)
print(json.dumps({'video':str(OUT), 'duration_seconds':sum(duration for _, duration in segments), 'resolution':'1920x1080', 'fps':30, 'bytes':OUT.stat().st_size, 'captured_signals':sorted(set(frame['signal'] for frame in frames))}, indent=2))
