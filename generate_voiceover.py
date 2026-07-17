import urllib.request
import json
import os

API_KEY = "sk_131db14afe34102feabd55d576dadfa3b3caf43b405c681b"
VOICE_ID = "HMsHSO9iPieho74ZXn8A"  # Nessa - Platinum Automotive inbound voice

OUTPUT_DIR = os.path.expanduser("~/mashai-website/voiceover")
os.makedirs(OUTPUT_DIR, exist_ok=True)

lines = [
    ("01_problem",   "Every missed call is a missed customer."),
    ("02_meet",      "Meet Mash. Your AI receptionist, answering every call."),
    ("03_how",       "Mash answers instantly, captures the details, and summarises the call."),
    ("04_crm",       "Mash connects to the tools you already use — HubSpot, Salesforce, Service M8, and more — so every lead syncs automatically."),
    ("05_dashboard", "Every call, every lead, live on one dashboard."),
    ("06_cta",       "Never miss a call again. Start your free trial at mash AI dot com dot au."),
]

for filename, text in lines:
    print(f"Generating {filename}...")
    payload = json.dumps({
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.85,
            "style": 0.2,
            "use_speaker_boost": True
        }
    }).encode()

    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        data=payload,
        headers={
            "xi-api-key": API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        }
    )
    try:
        with urllib.request.urlopen(req) as r:
            audio = r.read()
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.read().decode()}")
        break

    out_path = os.path.join(OUTPUT_DIR, f"{filename}.mp3")
    with open(out_path, "wb") as f:
        f.write(audio)
    print(f"  ✓ Saved to {out_path}")

print(f"\nDone! All files saved to {OUTPUT_DIR}")
