import os
import json
import urllib.request
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") + "/rest/v1/integrations"
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

body = {
    "workspace_id": "default",
    "service": "test_service",
    "tokens": {"test": "data"},
    "updated_at": "2026-06-30T13:00:00.000Z"
}

req = urllib.request.Request(
    url,
    data=json.dumps(body).encode("utf-8"),
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as res:
        print("Success:", res.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("Error:", e.code, e.read().decode("utf-8"))
